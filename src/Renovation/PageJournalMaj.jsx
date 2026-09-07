import React, { useMemo, useState, useEffect } from "react";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { Newspaper, Search, ChevronDown, ChevronRight, ArrowUpRight, X } from "lucide-react";
import { JOURNAL_MAJ, TYPES_MAJ } from "./journalMaj";

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisLabel = (ym) => {
  const [y, m] = String(ym).split("-");
  const nom = MOIS_FR[parseInt(m, 10) - 1] || m;
  return `${nom.charAt(0).toUpperCase()}${nom.slice(1)} ${y}`;
};
const dateFR = (iso) => {
  const d = iso ? new Date(iso + "T00:00:00") : null;
  return d && !isNaN(d.getTime())
    ? d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    : "";
};
const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Dernière visite : sert à marquer « Nouveau » ce qui a été publié depuis.
const LAST_SEEN_KEY = "journal_maj_derniere_visite";

// Journal des MAJ : liste des mises à jour de l'application, expliquées.
// Le contenu vit dans journalMaj.js — cette page ne fait que l'afficher
// (recherche, filtre par type, regroupement par mois, détail dépliable).
export default function PageJournalMaj({ T, branch = "renovation", onOuvrirPage = null, peutOuvrir = null }) {
  const acc = getBranchAccent(branch);
  const [recherche, setRecherche] = useState("");
  const [typeFiltre, setTypeFiltre] = useState("tous");
  const [ouverts, setOuverts] = useState({}); // { [index d'entrée]: true } — détail « Comment ça marche » déplié

  // Pastille « Nouveau » : tout ce qui est postérieur à la dernière visite.
  const [derniereVisite] = useState(() => {
    try { return localStorage.getItem(LAST_SEEN_KEY) || ""; } catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem(LAST_SEEN_KEY, new Date().toLocaleDateString("sv-SE")); } catch {}
  }, []);

  const entrees = useMemo(() => {
    const q = normalize(recherche.trim());
    return JOURNAL_MAJ
      .map((e, i) => ({ ...e, _key: i }))
      .filter((e) => typeFiltre === "tous" || e.type === typeFiltre)
      .filter((e) => {
        if (!q) return true;
        const texte = normalize([e.titre, e.quoi, e.comment, ...(e.pages || []).map((p) => p.label)].join(" "));
        return texte.includes(q);
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [recherche, typeFiltre]);

  // Regroupement par mois (les entrées sont déjà triées par date décroissante).
  const parMois = useMemo(() => {
    const groupes = [];
    let courant = null;
    entrees.forEach((e) => {
      const mois = (e.date || "").slice(0, 7);
      if (!courant || courant.mois !== mois) {
        courant = { mois, items: [] };
        groupes.push(courant);
      }
      courant.items.push(e);
    });
    return groupes;
  }, [entrees]);

  const compteurs = useMemo(() => {
    const c = { tous: JOURNAL_MAJ.length, nouveaute: 0, amelioration: 0, correctif: 0 };
    JOURNAL_MAJ.forEach((e) => { if (c[e.type] != null) c[e.type]++; });
    return c;
  }, []);

  const filtres = [
    { id: "tous", label: "Tout" },
    ...Object.entries(TYPES_MAJ).map(([id, t]) => ({ id, label: t.label + "s", color: t.color })),
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 60px" }}>

        {/* ── En-tête ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <div style={{
            width: 44, height: 44, borderRadius: RADIUS.md, background: acc.bg10,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={Newspaper} size={22} color={acc.accent} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: .2 }}>
              Journal des mises à jour
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: FONT.sm.size, color: T.textSub }}>
              Ce qui a changé dans l'application : à quoi ça sert, comment ça fonctionne.
            </p>
          </div>
        </div>

        {/* ── Barre de recherche + filtres ── */}
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
          margin: "18px 0 4px", position: "sticky", top: 0, zIndex: 5,
          background: T.bg, padding: "10px 0",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px",
            background: T.inputBg, border: `1px solid ${T.fieldBorder}`,
            borderRadius: RADIUS.md, padding: "8px 12px",
          }}>
            <Icon as={Search} size={15} color={T.textMuted} />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher une mise à jour, une page…"
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 1,
              }}
            />
            {recherche && (
              <button onClick={() => setRecherche("")} title="Effacer" style={{
                background: "transparent", border: "none", cursor: "pointer", padding: 2,
                color: T.textMuted, display: "flex",
              }}>
                <Icon as={X} size={14} />
              </button>
            )}
          </div>

          {filtres.map((f) => {
            const actif = typeFiltre === f.id;
            const couleur = f.color || acc.accent;
            return (
              <button key={f.id} onClick={() => setTypeFiltre(f.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 12px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit",
                fontSize: FONT.xs.size + 1, fontWeight: actif ? 700 : 500, letterSpacing: .2,
                border: `1px solid ${actif ? couleur : T.border}`,
                background: actif ? `${couleur}1f` : "transparent",
                color: actif ? couleur : T.textSub,
                transition: "all .12s",
              }}>
                {f.id !== "tous" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: couleur }} />}
                {f.label}
                <span style={{ opacity: .55, fontWeight: 500 }}>{compteurs[f.id]}</span>
              </button>
            );
          })}
        </div>

        {/* ── Liste par mois ── */}
        {parMois.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.textMuted, fontSize: FONT.sm.size + 1 }}>
            Aucune mise à jour ne correspond à cette recherche.
          </div>
        )}

        {parMois.map((groupe) => (
          <div key={groupe.mois} style={{ marginTop: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{
                fontSize: FONT.xs.size + 1, fontWeight: 800, letterSpacing: 1.2,
                textTransform: "uppercase", color: acc.accent,
              }}>{moisLabel(groupe.mois)}</span>
              <span style={{ flex: 1, height: 1, background: T.sectionDivider }} />
              <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                {groupe.items.length} mise{groupe.items.length > 1 ? "s" : ""} à jour
              </span>
            </div>

            {groupe.items.map((e) => {
              const type = TYPES_MAJ[e.type] || TYPES_MAJ.amelioration;
              const ouvert = !!ouverts[e._key];
              const estNouveau = derniereVisite && e.date > derniereVisite;
              return (
                <div key={e._key} style={{
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderLeft: `3px solid ${type.color}`,
                  borderRadius: RADIUS.lg || 12, padding: "14px 16px", marginBottom: 10,
                }}>
                  {/* Ligne 1 : date + badge type + Nouveau */}
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600 }}>
                      {dateFR(e.date)}
                    </span>
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .5, textTransform: "uppercase",
                      color: type.color, background: `${type.color}1f`,
                      padding: "2px 8px", borderRadius: 99,
                    }}>{type.label}</span>
                    {estNouveau && (
                      <span style={{
                        fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase",
                        color: "#fff", background: acc.accent, padding: "2px 8px", borderRadius: 99,
                      }}>Nouveau</span>
                    )}
                  </div>

                  {/* Titre */}
                  <div style={{ fontSize: FONT.md?.size || 15, fontWeight: 750, color: T.text, lineHeight: 1.35, marginBottom: 6 }}>
                    {e.titre}
                  </div>

                  {/* À quoi ça sert */}
                  <p style={{ margin: "0 0 8px", fontSize: FONT.sm.size + 1, color: T.textSub, lineHeight: 1.55 }}>
                    {e.quoi}
                  </p>

                  {/* Comment ça marche (dépliable) */}
                  {e.comment && (
                    <div>
                      <button
                        onClick={() => setOuverts((o) => ({ ...o, [e._key]: !o[e._key] }))}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          background: "transparent", border: "none", padding: 0, cursor: "pointer",
                          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                          color: acc.accent, letterSpacing: .2,
                        }}>
                        <Icon as={ouvert ? ChevronDown : ChevronRight} size={14} />
                        Comment ça marche
                      </button>
                      {ouvert && (
                        <p style={{
                          margin: "8px 0 0", padding: "10px 12px",
                          background: T.widgetBg, border: `1px solid ${T.sectionDivider}`,
                          borderRadius: RADIUS.md, fontSize: FONT.sm.size + 1, color: T.textSub, lineHeight: 1.55,
                        }}>
                          {e.comment}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Pages concernées */}
                  {(e.pages || []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {e.pages.map((p) => {
                        const cliquable = !!onOuvrirPage && (!peutOuvrir || peutOuvrir(p.id)) && p.id !== "journal-maj";
                        return (
                          <button
                            key={p.id}
                            onClick={cliquable ? () => onOuvrirPage(p.id) : undefined}
                            disabled={!cliquable}
                            title={cliquable ? `Ouvrir ${p.label}` : ""}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "4px 10px", borderRadius: 99, fontFamily: "inherit",
                              fontSize: FONT.xs.size + 1, fontWeight: 600,
                              border: `1px solid ${T.border}`, background: T.card,
                              color: cliquable ? T.text : T.textMuted,
                              cursor: cliquable ? "pointer" : "default",
                            }}>
                            {p.label}
                            {cliquable && <Icon as={ArrowUpRight} size={12} color={T.textMuted} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
