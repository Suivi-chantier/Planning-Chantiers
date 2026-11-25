// ─────────────────────────────────────────────────────────────────────────────
// Écran de la fiche de préparation sécurité d'un chantier (tâche 3 du projet
// docs/projets/fiche-securite-chantier.md). Bureau, ordinateur et tablette.
// Ouvert depuis le panneau « Fiche sécurité » de la page Opération.
//
// Ordre du PDF v2 : bandeau d'identification, point 1 (intervenants), point 2
// (données de base + bâtiment en lecture), cartes 4 à 12, synthèse (point 3).
// Justificatifs : liste de ce qui est attendu, sans ajout (tâche 4).
//
// Enregistrement automatique avec anti-rebond. L'indicateur ne dit
// « enregistré » qu'après une écriture réussie ; une écriture refusée ou en
// conflit (fiche modifiée ailleurs, plus en brouillon) reste affichée
// « erreur, non enregistré ». Une fiche qui n'est pas en brouillon, ou dont le
// contenu a une forme inattendue, s'affiche en lecture seule.
//
// Toute la logique (n/12, normalisation, structure) : securiteFiche.mjs.
// Définition des points : securite/points.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT, RADIUS, LOTS_DEFAUT, loadLots } from "../constants";
import { Icon } from "../ui";
import { ArrowLeft, ShieldCheck, Plus, Trash2, Building2, Paperclip } from "lucide-react";
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
import { chargerFiche, chargerBatiment, enregistrerFiche } from "./securiteDonnees.js";
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

function Justificatifs({ T, point }) {
  if (!point?.justificatifs?.length) return null;
  return (
    <div style={{ marginTop: 12, borderTop: `1px dashed ${T.border}`, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
        <Icon as={Paperclip} size={12}/> Justificatifs attendus
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {point.justificatifs.map((j) => (
          <span key={j.type_code} style={{ fontSize: 12, padding: "4px 10px", borderRadius: RADIUS.pill, border: `1px solid ${T.border}`, color: T.textSub }}>
            {libelleJustificatif(j.type_code)}
            <b style={{ marginLeft: 6, fontWeight: 700, color: j.requis ? ORANGE : T.textMuted }}>{j.requis ? "requis si concerné" : "selon le cas"}</b>
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic", marginTop: 6 }}>L'ajout des documents arrive avec la prochaine livraison.</div>
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

function CartePoint({ T, acc, point, reponse, modifiable, onChange, styles }) {
  const r = reponse && typeof reponse === "object" && !Array.isArray(reponse) ? reponse : {};
  const cases = r.cases && typeof r.cases === "object" ? r.cases : {};
  const statutInconnu = r.statut !== undefined && !STATUTS_POINT.some((s) => s.id === r.statut);
  return (
    <Carte T={T} numero={point.numero} titre={point.titre} objet={point.objet}
      droite={statutInconnu
        ? <span style={{ fontSize: 12, fontWeight: 700, color: ROUGE }}>{libelleStatutPoint(r.statut)}</span>
        : <ChoixStatut T={T} acc={acc} valeur={r.statut} modifiable={modifiable} onChange={(s) => onChange({ statut: s })}/>}>
      {r.statut_propose != null && (
        <div style={{ fontSize: 12, color: T.textSub, marginBottom: 8 }}>
          Proposé : <b>{libelleStatutPoint(r.statut_propose)}</b>{r.raison_proposition ? ` — ${r.raison_proposition}` : ""}
        </div>
      )}
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
      <Justificatifs T={T} point={point}/>
    </Carte>
  );
}

export default function FicheSecuriteChantier({ T, acc, op, chantier, profil = null, onClose }) {
  const auteur = profil?.nom || profil?.email || null;
  const [lecture, setLecture] = useState({ charge: false, ligne: null, erreur: null });
  const [form, setForm] = useState(null);
  const [enreg, setEnreg] = useState({ etat: "enregistre", messages: [], conflit: null });
  const [batiment, setBatiment] = useState({ charge: false, ligne: null, erreur: null });
  const [clients, setClients] = useState({ charge: false, liste: [], erreur: null });
  const [lots, setLots] = useState(LOTS_DEFAUT);

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
  const indic = libelleEnregistrement(mode.modifiable && !lecture.erreur ? enreg.etat : "lecture_seule");
  const couleurIndic = indic.ton === "ok" ? VERT : indic.ton === "erreur" ? ROUGE : indic.ton === "attente" ? ORANGE : T.textMuted;

  const idClient = clientEffectifId(chantier, op);
  const client = idClient ? clients.liste.find((c) => c.id === idClient) : null;
  const texteClient = !clients.charge ? "chargement…"
    : clients.erreur ? `client illisible (${clients.erreur})`
    : !idClient ? "aucun client renseigné — à saisir sur la page de l'opération"
    : client ? libelleClient(client) : "client introuvable";

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
                    ["Points complétés", nbPoints === null ? `?/${NB_POINTS_FICHE}` : `${nbPoints}/${NB_POINTS_FICHE}`],
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
              </section>

              {/* ── Point 1 : intervenants ── */}
              <Carte T={T} numero={1} titre={p1.titre} objet={p1.objet}>
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
                <Justificatifs T={T} point={p1}/>
              </Carte>

              {/* ── Point 2 : données de base ── */}
              <Carte T={T} numero={2} titre={p2.titre} objet={p2.objet}>
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
                <Justificatifs T={T} point={p2}/>
              </Carte>

              {/* ── Points 4 à 12 ── */}
              {POINTS_CARTES.map((p) => (
                <CartePoint key={p.cle} T={T} acc={acc} point={p} reponse={form.reponses[p.cle]} modifiable={modifiable} styles={styles}
                  onChange={(chg) => modifier((f) => modifierPoint(f, p.cle, chg, { auteur, maintenant: new Date().toISOString() }))}/>
              ))}

              {/* ── Point 3 : synthèse des risques ── */}
              <Carte T={T} numero={3} titre={p3.titre} objet={p3.objet}>
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
                <Justificatifs T={T} point={p3}/>
              </Carte>

              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic", textAlign: "center", marginTop: 6 }}>
                Justificatifs, signatures et validation de la fiche arrivent avec la prochaine livraison.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
