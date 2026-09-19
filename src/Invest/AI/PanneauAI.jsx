// src/Invest/AI/PanneauAI.jsx — L'interface de Profero AI.
//
// Volet latéral sur grand écran, feuille plein écran sur téléphone. La page
// reste montée derrière : on ne perd ni saisie ni filtre en posant une
// question.
//
// Principe d'affichage, et c'est le mécanisme anti-hallucination de la V1 :
// LE TEXTE DU MODÈLE N'EST QU'UN COMMENTAIRE. Les données affichées viennent
// des `blocs`, c'est-à-dire des sorties d'outils collectées côté serveur. Ce
// composant ne sait pas fabriquer une ligne de tableau à partir d'une phrase :
// s'il n'y a pas de bloc, il n'affiche pas de données.
//
// Les liens ne sont pas des URL. Profero Invest n'a pas de routeur : le
// serveur renvoie les paramètres du mécanisme de liens profonds déjà en place
// (client_id, invest_bien…) et on appelle naviguer(), ce qui évite de
// recharger l'application et de perdre le contexte.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, Send, ArrowRight, AlertTriangle, Loader } from "lucide-react";
import { Icon } from "../../ui";
import { useCopilote } from "./useCopilote";

const SUGGESTIONS = [
  "Quels dossiers sont bloqués ?",
  "Quelles sont les échéances des 7 prochains jours ?",
  "Quelles sont mes priorités aujourd'hui ?",
];

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short",
    });
  } catch { return String(d); }
};

const COULEUR_URGENCE = (T, niveau) =>
  niveau === "danger" ? "#e15a5a"
  : niveau === "warning" ? "#e0a961"
  : niveau === "success" ? "#50c878"
  : T.textSub || "#8a93a6";

// ─── Rendu des blocs ─────────────────────────────────────────────────────────

function Lien({ lien, onNaviguer, T }) {
  if (!lien || !lien.params) return null;
  const params = lien.params;
  const cible = params.client_id
    ? { tab: "crm", action: "open", id: params.client_id }
    : params.invest_bien
    ? { tab: "biens", action: "open", id: params.invest_bien }
    : null;
  if (!cible) return null;
  return (
    <button
      type="button"
      onClick={() => onNaviguer && onNaviguer(cible.tab, cible)}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer",
        color: T.accent, font: "inherit", fontWeight: 600,
        display: "inline-flex", alignItems: "center", gap: 4,
      }}
    >
      {lien.libelle || "Ouvrir"} <Icon as={ArrowRight} size={12} />
    </button>
  );
}

function Tableau({ colonnes, lignes, T }) {
  if (!lignes.length) return null;
  return (
    <div style={{ overflowX: "auto", margin: "8px 0 4px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead>
          <tr>
            {colonnes.map((c) => (
              <th key={c.cle} style={{
                textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap",
                color: T.textSub, fontWeight: 600, fontSize: 10.5,
                textTransform: "uppercase", letterSpacing: ".06em",
                borderBottom: `1px solid ${T.border || "#333944"}`,
              }}>{c.titre}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              {colonnes.map((c) => (
                <td key={c.cle} style={{
                  padding: "6px 8px", verticalAlign: "top", color: T.text,
                  borderBottom: `1px solid ${T.borderSoft || T.border || "#282d36"}`,
                }}>{c.rendu(l)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bloc({ bloc, onNaviguer, T }) {
  const r = bloc && bloc.resultat;
  if (!r || typeof r !== "object") return null;

  const cadre = {
    border: `1px solid ${T.border || "#333944"}`, borderRadius: 8,
    background: T.surface || T.card || "#1e2128", padding: "10px 12px", marginTop: 8,
  };
  const titre = (
    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 2 }}>
      {r.titre || bloc.outil}
    </div>
  );

  if (r.type === "absence") {
    return <div style={cadre}>{titre}</div>;
  }

  if (r.type === "liste_dossiers" || r.type === "liste_priorites") {
    const lignes = r.dossiers || r.priorites || [];
    return (
      <div style={cadre}>
        {titre}
        <Tableau T={T} lignes={lignes} colonnes={[
          { cle: "dossier", titre: "Dossier", rendu: (l) => (
            <span>
              <Lien lien={l.lien} onNaviguer={onNaviguer} T={T} />
              {!l.lien && (l.libelle || "—")}
              {l.lien && <div style={{ color: T.textSub, fontSize: 11 }}>{l.libelle}</div>}
            </span>
          ) },
          { cle: "etape", titre: "Étape", rendu: (l) => l.etape || l.sous_titre || "—" },
          { cle: "alerte", titre: "Point d'attention", rendu: (l) => (
            <span style={{ color: COULEUR_URGENCE(T, l.urgence) }}>{l.alerte_principale || "—"}</span>
          ) },
          { cle: "action", titre: "Prochaine action", rendu: (l) => l.prochaine_action || "—" },
          { cle: "echeance", titre: "Échéance", rendu: (l) => fmtDate(l.echeance) },
          { cle: "resp", titre: "Responsable", rendu: (l) => l.responsable || "—" },
        ]} />
      </div>
    );
  }

  if (r.type === "liste_echeances") {
    return (
      <div style={cadre}>
        {titre}
        <Tableau T={T} lignes={r.echeances || []} colonnes={[
          { cle: "date", titre: "Date", rendu: (l) => (
            <span style={{ color: l.en_retard ? "#e15a5a" : T.text, fontWeight: l.en_retard ? 700 : 400 }}>
              {fmtDate(l.date)}{l.en_retard ? " · retard" : ""}
            </span>
          ) },
          { cle: "dossier", titre: "Dossier", rendu: (l) => (
            <span><Lien lien={l.lien} onNaviguer={onNaviguer} T={T} />{!l.lien && (l.dossier || "—")}
              {l.lien && <div style={{ color: T.textSub, fontSize: 11 }}>{l.dossier}</div>}</span>
          ) },
          { cle: "echeance", titre: "Échéance", rendu: (l) => l.echeance || "—" },
          { cle: "etape", titre: "Étape", rendu: (l) => l.etape || "—" },
          { cle: "resp", titre: "Responsable", rendu: (l) => l.responsable || "—" },
        ]} />
      </div>
    );
  }

  if (r.type === "liste_clients") {
    return (
      <div style={cadre}>
        {titre}
        <Tableau T={T} lignes={r.clients || []} colonnes={[
          { cle: "nom", titre: "Client", rendu: (l) => <Lien lien={l.lien} onNaviguer={onNaviguer} T={T} /> },
          { cle: "nom2", titre: "Nom", rendu: (l) => l.nom || "—" },
          { cle: "etape", titre: "Étape", rendu: (l) => l.etape || "—" },
          { cle: "action", titre: "Prochaine action", rendu: (l) => l.prochaine_action || "—" },
          { cle: "echeance", titre: "Échéance", rendu: (l) => fmtDate(l.echeance) },
          { cle: "resp", titre: "Responsable", rendu: (l) => l.responsable || "—" },
        ]} />
      </div>
    );
  }

  if (r.type === "resume_client") {
    const c = r.client || {};
    const paire = (k, v) => (
      <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
        <span style={{ color: T.textSub, minWidth: 116 }}>{k}</span>
        <span style={{ color: T.text, fontWeight: 500 }}>{v ?? "—"}</span>
      </div>
    );
    return (
      <div style={cadre}>
        {titre}
        <div style={{ marginTop: 6 }}>
          {paire("Étape actuelle", c.etape)}
          {paire("Statut", c.statut)}
          {paire("Responsable", c.responsable)}
          {paire("Progression", r.progression ? `${r.progression.faites} / ${r.progression.total} actions` : null)}
          {paire("Prochaine action", r.prochaine_action?.libelle)}
          {paire("Échéance", fmtDate(r.prochaine_action?.echeance))}
        </div>
        {(r.points_bloquants || []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: "#e15a5a", fontWeight: 700 }}>
              Points bloquants
            </div>
            {r.points_bloquants.map((b, i) => (
              <div key={i} style={{ fontSize: 12.5, color: T.text, padding: "2px 0" }}>
                {b.action} <span style={{ color: T.textSub }}>· {b.etape} · {fmtDate(b.echeance)}</span>
              </div>
            ))}
          </div>
        )}
        {(r.actions_en_retard || []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: "#e0a961", fontWeight: 700 }}>
              Actions en retard
            </div>
            {r.actions_en_retard.map((a, i) => (
              <div key={i} style={{ fontSize: 12.5, color: T.text, padding: "2px 0" }}>
                {a.action} <span style={{ color: T.textSub }}>· {fmtDate(a.echeance)}</span>
              </div>
            ))}
          </div>
        )}
        {(r.biens_proposes || []).filter((b) => b.bien).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: T.textSub, fontWeight: 700 }}>
              Biens proposés
            </div>
            {r.biens_proposes.filter((b) => b.bien).map((b, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "2px 0" }}>
                <Lien lien={b.bien.lien} onNaviguer={onNaviguer} T={T} />
                <span style={{ color: T.textSub }}> {b.bien.adresse} · {b.statut_proposition || "—"}</span>
              </div>
            ))}
          </div>
        )}
        {(r.notes_recentes || []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: T.textSub, fontWeight: 700 }}>
              Dernières notes
            </div>
            {r.notes_recentes.map((n, i) => (
              <div key={i} style={{ fontSize: 12, color: T.text, padding: "3px 0" }}>
                <span style={{ color: T.textSub }}>{fmtDate(n.date)} · {n.auteur || "—"} — </span>{n.extrait}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8 }}><Lien lien={r.lien} onNaviguer={onNaviguer} T={T} /></div>
      </div>
    );
  }

  // Type inconnu : on le dit, plutôt que d'afficher un objet brut ou rien.
  return (
    <div style={cadre}>
      {titre}
      <div style={{ fontSize: 12, color: T.textSub }}>
        Résultat de type « {r.type || "?"} » non encore mis en forme par l'interface.
      </div>
    </div>
  );
}

// ─── Panneau ─────────────────────────────────────────────────────────────────

export default function PanneauAI({ ouvert, onFermer, T, profil, contexte, onNaviguer, estMobile }) {
  const { echanges, enCours, demander, reinitialiser } = useCopilote();
  const [saisie, setSaisie] = useState("");
  const champRef = useRef(null);
  const finRef = useRef(null);

  useEffect(() => {
    if (ouvert && champRef.current) champRef.current.focus();
  }, [ouvert]);

  useEffect(() => {
    if (finRef.current) finRef.current.scrollIntoView({ block: "end" });
  }, [echanges]);

  // Échap ferme, où que soit le focus.
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e) => { if (e.key === "Escape") onFermer(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ouvert, onFermer]);

  const libelleContexte = useMemo(() => {
    if (!contexte) return null;
    if (contexte.entite_type === "client" && contexte.entite_id) return "Fiche client ouverte";
    if (contexte.entite_type === "bien" && contexte.entite_id) return "Fiche bien ouverte";
    if (contexte.page) return `Page ${contexte.page}`;
    return null;
  }, [contexte]);

  if (!ouvert) return null;

  const envoyer = () => {
    const q = saisie.trim();
    if (!q || enCours) return;
    setSaisie("");
    demander(q, contexte);
  };

  return (
    <div
      role="dialog"
      aria-label="Profero AI"
      style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        left: estMobile ? 0 : "auto",
        width: estMobile ? "100%" : 460,
        maxWidth: "100%",
        zIndex: 12000,
        display: "flex", flexDirection: "column",
        background: T.bg || "#16181d",
        borderLeft: estMobile ? "none" : `1px solid ${T.border || "#333944"}`,
        boxShadow: estMobile ? "none" : "-12px 0 32px -18px rgba(0,0,0,.55)",
      }}
    >
      {/* En-tête */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        borderBottom: `1px solid ${T.border || "#333944"}`, flexShrink: 0,
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: 8, display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          background: "rgba(64,112,232,.14)", color: T.accent,
        }}><Icon as={Sparkles} size={14} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text, letterSpacing: .3 }}>Profero AI</div>
          <div style={{ fontSize: 11, color: T.textSub }}>
            Lecture seule{libelleContexte ? ` · ${libelleContexte}` : ""}
          </div>
        </div>
        {echanges.length > 0 && (
          <button type="button" onClick={reinitialiser} style={{
            background: "none", border: "none", cursor: "pointer",
            color: T.textSub, fontSize: 11.5, padding: "4px 6px",
          }}>Effacer</button>
        )}
        <button type="button" onClick={onFermer} aria-label="Fermer" style={{
          background: "none", border: "none", cursor: "pointer", color: T.textSub, padding: 4,
          display: "inline-flex",
        }}><Icon as={X} size={16} /></button>
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px" }}>
        {echanges.length === 0 && (
          <div>
            <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.55, marginBottom: 12 }}>
              Posez une question sur vos dossiers, vos biens ou vos échéances.
              Profero AI consulte les données de Profero Invest ; il ne modifie rien.
            </div>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => demander(s, contexte)} style={{
                display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                background: T.surface || T.card || "#1e2128",
                border: `1px solid ${T.border || "#333944"}`, borderRadius: 8,
                padding: "9px 11px", marginBottom: 7, color: T.text, fontSize: 12.5,
              }}>{s}</button>
            ))}
          </div>
        )}

        {echanges.map((e, i) => (
          <div key={i} style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: T.text,
              background: T.surface || T.card || "#1e2128",
              border: `1px solid ${T.border || "#333944"}`,
              borderRadius: 8, padding: "8px 11px",
            }}>{e.question}</div>

            {e.enAttente && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, color: T.textSub, fontSize: 12.5 }}>
                <Icon as={Loader} size={13} /> Consultation des dossiers…
              </div>
            )}

            {e.erreur && (
              <div style={{
                display: "flex", gap: 8, marginTop: 9, padding: "9px 11px",
                border: "1px solid rgba(225,90,90,.35)", borderRadius: 8,
                background: "rgba(225,90,90,.08)", color: "#e15a5a", fontSize: 12.5,
              }}>
                <Icon as={AlertTriangle} size={14} />
                <span>{e.erreur}</span>
              </div>
            )}

            {e.reponse && (
              <div style={{ marginTop: 9, fontSize: 13, color: T.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {e.reponse}
              </div>
            )}

            {(e.blocs || []).map((b, j) => (
              <Bloc key={j} bloc={b} onNaviguer={onNaviguer} T={T} />
            ))}

            {e.outils && e.outils.length > 0 && (
              <div style={{ marginTop: 7, fontSize: 10.5, color: T.textSub, letterSpacing: ".03em" }}>
                Source : {e.outils.join(", ")}
              </div>
            )}
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {/* Saisie */}
      <div style={{
        flexShrink: 0, padding: "10px 12px", borderTop: `1px solid ${T.border || "#333944"}`,
        display: "flex", gap: 8, alignItems: "flex-end",
      }}>
        <textarea
          ref={champRef}
          value={saisie}
          onChange={(ev) => setSaisie(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); envoyer(); }
          }}
          rows={1}
          placeholder="Où en est le dossier de…"
          style={{
            flex: 1, resize: "none", minHeight: 38, maxHeight: 120,
            background: T.surface || T.card || "#1e2128",
            border: `1px solid ${T.border || "#333944"}`, borderRadius: 8,
            padding: "9px 11px", color: T.text, fontSize: 13, fontFamily: "inherit",
          }}
        />
        <button
          type="button"
          onClick={envoyer}
          disabled={enCours || !saisie.trim()}
          aria-label="Envoyer"
          style={{
            height: 38, width: 38, flexShrink: 0, borderRadius: 8, border: "none",
            cursor: enCours || !saisie.trim() ? "default" : "pointer",
            background: enCours || !saisie.trim() ? (T.border || "#333944") : T.accent,
            color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        ><Icon as={Send} size={15} /></button>
      </div>
    </div>
  );
}
