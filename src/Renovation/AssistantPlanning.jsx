// ─── ASSISTANT PLANNING RÉNOVATION (chantier 10, étape 2) ───────────────────
// Bouton flottant « Assistant » + panneau latéral droit, monté dans App.jsx
// pour les seuls administrateurs (role === "admin"), sur toutes les pages
// Rénovation. Parcours (maquette validée, 3 écrans) :
//   1. texte libre → tâche IA serveur renovation_planning_consigne, qui TRADUIT
//      (jamais d'écriture) : aperçu, proposition, question à choix, ou
//      information ;
//   1 bis. « aperçu » (« montre le planning de la semaine prochaine pour … ») :
//      le moteur tourne ici, RIEN n'est enregistré, et l'écran compare le
//      planning actuel à la proposition du moteur sur le périmètre demandé ;
//   2. fiche de consigne, revalidée ICI avec les listes réelles lues avec le
//      compte de l'administrateur, et ses avertissements (hors équipe, 0 h…) ;
//   3. « Enregistrer et recalculer » : moteur avant → écriture de LA ligne
//      (source = assistant) → moteur après → aperçu Avant / Après.
// Pas de bouton « Appliquer » : l'application au planning est l'étape 3.
//
// Aucune règle ici : voir assistantPlanningConsigneV1.mjs (consigne),
// assistantPlanningApercuV1.mjs (aperçu) et assistantPlanningDonnees.js (accès).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, X, ArrowRight, TriangleAlert, Info, CircleAlert, Loader2, Trash2, RotateCcw, CheckCircle2,
} from "lucide-react";
import { Button, Icon } from "../ui";
import { FONT, RADIUS, SEMANTIC, SHADOW, getBranchAccent } from "../constants";
import { useIsMobile } from "../hooks";
import { lundiDeLaSemaineV1 } from "./assistantPlanningConsigneV1.js";
import { construireApercuPlanningActuelV1, construireApercuRecalculV1, semainesDisponiblesV1 } from "./assistantPlanningApercuV1.js";
import {
  annulerConsigne, apercuSansConsigne, capaciteBasePlanningPourDate, chargerAbsences, chargerConsignesAssistant, chargerReferentiel,
  enregistrerConsigne, fenetrePourFiche, recalculer, traduireConsigne, validerDansLeNavigateur,
} from "./assistantPlanningDonnees.js";
import { BandeauFins, GrilleRecalcul, ResumeRecalcul } from "./AssistantPlanningApercu.jsx";

const LARGEUR_PANNEAU = 460;
const RACCOURCIS = [
  { libelle: "Planning de la semaine prochaine", texte: "Fais le planning de la semaine prochaine pour " },
  { libelle: "Déclarer une absence", texte: "… est absent " },
  { libelle: "Affecter quelqu'un", texte: "… va réaliser … sur le chantier … même si ce n'est pas son équipe" },
  { libelle: "Intervention figée", texte: "J'ai programmé une intervention le " },
];
const PHASES = {
  apercu: "Calcul du planning proposé…",
  avant: "Calcul du planning actuel par le moteur…",
  ecriture: "Enregistrement de la consigne…",
  apres: "Recalcul avec la consigne…",
};

function Bulle({ children, T, droite }) {
  return (
    <div style={{
      alignSelf: droite ? "flex-end" : "stretch", maxWidth: droite ? "85%" : "100%",
      background: droite ? T.surface : "transparent", border: droite ? `1px solid ${T.border}` : "none",
      borderRadius: droite ? `${RADIUS.xl}px ${RADIUS.xl}px ${RADIUS.sm}px ${RADIUS.xl}px` : 0,
      padding: droite ? "10px 14px" : 0, fontSize: FONT.md.size, lineHeight: 1.5, color: T.text, whiteSpace: "pre-wrap",
    }}>{children}</div>
  );
}

function Encart({ niveau = "info", children, T }) {
  const sem = niveau === "danger" ? SEMANTIC.danger : niveau === "attention" ? SEMANTIC.warning : null;
  const IconeEncart = niveau === "danger" ? CircleAlert : niveau === "attention" ? TriangleAlert : Info;
  return (
    <div style={{
      display: "flex", gap: 10, padding: 12, borderRadius: RADIUS.lg, fontSize: FONT.base.size, lineHeight: 1.45, color: T.text,
      background: sem ? sem.bg : T.card, border: `1px solid ${sem ? sem.border : T.border}`,
    }}>
      <Icon as={IconeEncart} size={18} color={sem ? sem.color : T.textSub} style={{ flexShrink: 0, marginTop: 1 }}/>
      <span>{children}</span>
    </div>
  );
}

function BoutonContour({ children, T, ...props }) {
  return (
    <button type="button" {...props} style={{
      minHeight: 44, padding: "0 16px", borderRadius: RADIUS.lg, border: `1px solid ${T.fieldBorder}`,
      background: "transparent", color: T.text, fontFamily: "inherit", fontSize: FONT.base.size, fontWeight: 700,
      cursor: props.disabled ? "not-allowed" : "pointer", opacity: props.disabled ? 0.55 : 1, ...(props.style || {}),
    }}>{children}</button>
  );
}

function FicheConsigne({ msg, actif, occupe, onEnregistrer, onAnnuler, T, acc }) {
  const { fiche, validation } = msg;
  return (
    <div style={{ background: T.bg, border: `1px solid ${acc.accent}`, borderRadius: RADIUS.xl, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: acc.onAccent, background: acc.accent, borderRadius: RADIUS.sm, padding: "3px 8px" }}>
          {fiche?.etiquette || "Consigne"}
        </span>
        {fiche?.visibilite && <span style={{ fontSize: FONT.sm.size, color: T.textSub }}>{fiche.visibilite}</span>}
      </div>
      {fiche?.lignes?.length > 0 && (
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: "6px 12px", fontSize: FONT.md.size }}>
          {fiche.lignes.map(l => (
            <React.Fragment key={l.libelle}>
              <dt style={{ color: T.textSub }}>{l.libelle}</dt>
              <dd style={{ margin: 0, fontWeight: 700, color: T.text, overflowWrap: "anywhere" }}>{l.valeur}</dd>
            </React.Fragment>
          ))}
          {fiche.effet && (<><dt style={{ color: T.textSub }}>Effet</dt><dd style={{ margin: 0, color: T.text }}>{fiche.effet}</dd></>)}
        </dl>
      )}
      {(fiche?.avertissements || []).map(a => <Encart key={a.code} niveau={a.niveau} T={T}>{a.message}</Encart>)}
      {!validation.ok && (
        <Encart niveau="danger" T={T}>
          <b>Je ne peux pas enregistrer cette consigne :</b> {validation.erreurs.map(e => e.message).join(" ")}
        </Encart>
      )}
      {msg.etat === "enregistree" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.base.size, color: T.text }}>
          <Icon as={CheckCircle2} size={16} color={SEMANTIC.success.color}/> Consigne enregistrée.
        </div>
      ) : msg.etat === "abandonnee" ? (
        <div style={{ fontSize: FONT.base.size, color: T.textSub }}>Consigne abandonnée : rien n'a été enregistré.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" size="lg" disabled={!actif || occupe || !validation.ok} onClick={onEnregistrer}
            style={{ flexGrow: 1, minHeight: 44 }} icon={occupe ? Loader2 : undefined}>
            Enregistrer et recalculer
          </Button>
          <BoutonContour T={T} disabled={!actif || occupe} onClick={onAnnuler}>Annuler</BoutonContour>
        </div>
      )}
      {msg.etat !== "enregistree" && validation.ok && (
        <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.45 }}>Rien n'est enregistré avant votre validation, et le planning lui-même n'est jamais modifié ici.</div>
      )}
    </div>
  );
}

export default function AssistantPlanning({ T, profil, page, pageLibelle }) {
  const acc = getBranchAccent("renovation");
  const isMobile = useIsMobile();
  const [ouvert, setOuvert] = useState(false);
  const [messages, setMessages] = useState([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [phase, setPhase] = useState(null);
  // Consigne : { avant, apres, absences, ressources, id, table } ;
  // aperçu sans consigne : { mode: "apercu", resultat, absences, perimetre }.
  const [resultat, setResultat] = useState(null);
  const [erreurRecalcul, setErreurRecalcul] = useState("");
  const [vue, setVue] = useState("apres");
  const [lundi, setLundi] = useState(null);
  const [consignes, setConsignes] = useState([]);
  const [erreurConsignes, setErreurConsignes] = useState("");
  const finRef = useRef(null);
  const saisieRef = useRef(null);

  const rafraichirConsignes = useCallback(async () => {
    try { setConsignes(await chargerConsignesAssistant()); setErreurConsignes(""); }
    catch (e) { setErreurConsignes(e.message); }
  }, []);

  useEffect(() => { if (ouvert) rafraichirConsignes(); }, [ouvert, rafraichirConsignes]);
  useEffect(() => { finRef.current?.scrollIntoView({ block: "end" }); }, [messages, phase, resultat]);

  const ajouter = m => setMessages(prev => [...prev, m]);
  const modifier = (index, patch) => setMessages(prev => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const indexActif = messages.map(m => m.type).lastIndexOf("proposition");

  // Aperçu : moteur dans le navigateur, sans aucune écriture.
  const lancerApercu = async (perimetre) => {
    setErreurRecalcul("");
    setResultat(null);
    setPhase("apercu");
    try {
      const r = await apercuSansConsigne(perimetre);
      setResultat({ mode: "apercu", ...r });
      setLundi(lundiDeLaSemaineV1(r.perimetre.date_debut));
      setVue("apres");
    } catch (e) {
      setErreurRecalcul(`Je n'ai pas pu calculer le planning proposé : ${e.message}. Rien n'a été enregistré.`);
    } finally {
      setPhase(null);
    }
  };

  const envoyer = async (texteBrut) => {
    const question = String(texteBrut ?? saisie).trim();
    if (!question || enCours) return;
    const historique = messages
      .filter(m => m.texte)
      .map(m => ({ role: m.role, texte: m.choix?.length ? `${m.texte}\nChoix proposés : ${m.choix.map(c => c.libelle).join(" / ")}` : m.texte }));
    ajouter({ role: "user", texte: question });
    setSaisie("");
    setEnCours(true);
    try {
      const r = await traduireConsigne({ question, historique, contexte: { page, page_libelle: pageLibelle } });
      if (!r.ok) { ajouter({ role: "assistant", type: "erreur", texte: r.message }); return; }
      const res = r.resultat;
      if (res.type === "question") ajouter({ role: "assistant", type: "question", texte: res.message, choix: res.choix || [] });
      else if (res.type === "apercu") {
        ajouter({ role: "assistant", type: "apercu", texte: res.message });
        await lancerApercu(res.perimetre);
      } else if (res.type === "proposition") {
        const referentiel = await chargerReferentiel(res.consigne);
        const validation = validerDansLeNavigateur(res.consigne, referentiel);
        ajouter({ role: "assistant", type: "proposition", texte: res.message, consigne: res.consigne, validation, fiche: validation.fiche, texteOrigine: question });
      } else ajouter({ role: "assistant", type: "information", texte: res.message });
    } catch (e) {
      ajouter({ role: "assistant", type: "erreur", texte: `Je n'ai pas pu préparer la consigne : ${e.message}` });
    } finally {
      setEnCours(false);
    }
  };

  const enregistrerEtRecalculer = async (index) => {
    const msg = messages[index];
    if (!msg?.validation?.ok || enCours) return;
    setEnCours(true);
    setErreurRecalcul("");
    setResultat(null);
    const fenetre = fenetrePourFiche(msg.fiche);
    let avant;
    try {
      setPhase("avant");
      avant = await recalculer(fenetre);
    } catch (e) {
      setErreurRecalcul(`Le calcul du planning actuel a échoué : ${e.message}. Rien n'a été enregistré.`);
      setPhase(null); setEnCours(false); return;
    }
    let ligne;
    try {
      setPhase("ecriture");
      ligne = await enregistrerConsigne({ table: msg.validation.table, ligne: msg.validation.ligne, texteOrigine: msg.texteOrigine, email: profil?.email });
      modifier(index, { etat: "enregistree" });
      rafraichirConsignes();
    } catch (e) {
      setErreurRecalcul(`${e.message}. Rien n'a été enregistré.`);
      setPhase(null); setEnCours(false); return;
    }
    try {
      setPhase("apres");
      const [apres, absences] = await Promise.all([recalculer(fenetre), chargerAbsences()]);
      const l = msg.validation.ligne;
      setResultat({
        avant, apres, absences, id: ligne.id, table: msg.validation.table,
        ressources: [l.resource_id, ...((l.config && l.config.resource_ids) || [])].filter(Boolean),
      });
      setLundi(lundiDeLaSemaineV1(msg.fiche?.periode?.debut || fenetre.startDate));
      setVue("apres");
    } catch (e) {
      setErreurRecalcul(`Consigne enregistrée, mais le recalcul a échoué : ${e.message}. Vous pouvez l'annuler dans la liste ci-dessous.`);
    } finally {
      setPhase(null); setEnCours(false);
    }
  };

  const annuler = async (c) => {
    if (!window.confirm(`Annuler cette consigne ?\n${c.etiquette} — ${c.texte}\n\nElle sera supprimée.`)) return;
    try {
      await annulerConsigne({ table: c.table, id: c.id });
      if (resultat?.id === c.id) setResultat(null);
      await rafraichirConsignes();
    } catch (e) {
      setErreurConsignes(e.message);
    }
  };

  const semaines = useMemo(() => (resultat ? semainesDisponiblesV1(resultat.mode === "apercu" ? resultat.resultat : resultat.apres) : []), [resultat]);
  const apercu = useMemo(() => {
    if (!resultat) return null;
    if (resultat.mode === "apercu") {
      return construireApercuPlanningActuelV1({
        resultat: resultat.resultat, lundi, evenements: resultat.absences,
        capaciteBase: capaciteBasePlanningPourDate, chantierIds: resultat.perimetre.chantier_ids,
      });
    }
    return construireApercuRecalculV1({
      avant: resultat.avant, apres: resultat.apres, lundi, evenements: resultat.absences,
      capaciteBase: capaciteBasePlanningPourDate, ressourcesConsigne: resultat.ressources,
    });
  }, [resultat, lundi]);

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)} aria-label="Ouvrir l'assistant planning"
        style={{
          position: "fixed", right: 24, bottom: isMobile ? 164 : 24, zIndex: 905,
          minHeight: 52, padding: "0 20px 0 16px", border: "none", borderRadius: RADIUS.pill,
          background: acc.accent, color: acc.onAccent, boxShadow: SHADOW.lg,
          display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
          fontFamily: "inherit", fontSize: FONT.lg.size, fontWeight: 800, letterSpacing: 0.3,
        }}>
        <Icon as={Sparkles} size={20}/> Assistant
      </button>
    );
  }

  const large = !!apercu && !isMobile;
  const statut = phase ? PHASES[phase]
    : resultat?.mode === "apercu" ? "Planning proposé · rien n'est enregistré"
      : resultat ? "Consigne enregistrée · recalcul terminé" : "Planning et consignes · administrateurs";

  const panneau = (
    <aside role="dialog" aria-label="Assistant planning" style={{
      width: isMobile ? "100%" : LARGEUR_PANNEAU, flexShrink: 0, height: "100%", boxSizing: "border-box",
      background: T.modal, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column",
      boxShadow: large ? "none" : SHADOW.lg,
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ width: 40, height: 40, borderRadius: RADIUS.lg, background: acc.accent, color: acc.onAccent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon as={Sparkles} size={22}/>
        </div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: T.text }}>Assistant planning</div>
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, display: "flex", alignItems: "center", gap: 6 }}>
            {phase && <Icon as={Loader2} size={13} className="assistant-planning-spin"/>}{statut}
          </div>
        </div>
        <button type="button" aria-label="Fermer l'assistant" onClick={() => setOuvert(false)} style={{
          width: 44, height: 44, borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, background: "transparent",
          color: T.textSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}><Icon as={X} size={18}/></button>
      </header>

      <div style={{ flexGrow: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: FONT.md.size, lineHeight: 1.55, color: T.textSub }}>
            Demandez un planning (« Montre-moi le planning de la semaine prochaine ») ou donnez une consigne (« Steven est absent lundi prochain »). Rien n'est enregistré sans votre accord.
          </div>
        )}
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            {m.role === "user" && <Bulle T={T} droite>{m.texte}</Bulle>}
            {m.role === "assistant" && m.type === "erreur" && <Encart niveau="danger" T={T}>{m.texte}</Encart>}
            {m.role === "assistant" && (m.type === "information" || m.type === "apercu") && <Bulle T={T}>{m.texte}</Bulle>}
            {m.role === "assistant" && m.type === "question" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Bulle T={T}>{m.texte}</Bulle>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {m.choix.map(c => (
                    <BoutonContour key={c.libelle} T={T} disabled={enCours || i !== messages.length - 1} onClick={() => envoyer(c.demande || c.libelle)}>{c.libelle}</BoutonContour>
                  ))}
                </div>
              </div>
            )}
            {m.role === "assistant" && m.type === "proposition" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Bulle T={T}>{m.texte}</Bulle>
                <FicheConsigne msg={m} actif={i === indexActif} occupe={enCours} T={T} acc={acc}
                  onEnregistrer={() => enregistrerEtRecalculer(i)} onAnnuler={() => modifier(i, { etat: "abandonnee" })}/>
              </div>
            )}
          </React.Fragment>
        ))}
        {enCours && !phase && <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSub, fontSize: FONT.base.size }}><Icon as={Loader2} size={16} className="assistant-planning-spin"/> Je lis la consigne…</div>}
        {erreurRecalcul && <Encart niveau="danger" T={T}>{erreurRecalcul}</Encart>}

        {apercu && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>
              {resultat?.mode === "apercu" ? resultat.perimetre.libelle : "Voici ce que la consigne change."}
            </div>
            {resultat?.mode === "apercu" && (
              <Encart T={T}>Le moteur planifie tous les chantiers ensemble (équipes partagées) ; seul le périmètre demandé est affiché.</Encart>
            )}
            <ResumeRecalcul apercu={apercu} T={T} acc={acc}/>
            {isMobile && <GrilleRecalcul apercu={apercu} vue={vue} setVue={setVue} semaines={semaines} setLundi={setLundi} T={T} acc={acc} isMobile/>}
            {isMobile && <BandeauFins apercu={apercu} T={T}/>}
          </div>
        )}

        <section aria-label="Consignes créées par l'assistant" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: T.textSub }}>
            Consignes créées par l'assistant
          </div>
          {erreurConsignes && <Encart niveau="danger" T={T}>{erreurConsignes}</Encart>}
          {!erreurConsignes && consignes.length === 0 && <div style={{ fontSize: FONT.base.size, color: T.textSub }}>Aucune consigne active.</div>}
          {consignes.map(c => (
            <div key={`${c.table}-${c.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, background: T.card }}>
              <div style={{ flexGrow: 1, minWidth: 0, fontSize: FONT.base.size, color: T.text }}>
                <div style={{ fontWeight: 700 }}>{c.etiquette}</div>
                <div style={{ color: T.textSub, overflowWrap: "anywhere" }}>{c.texte}</div>
              </div>
              <button type="button" onClick={() => annuler(c)} disabled={enCours} style={{
                minHeight: 40, padding: "0 12px", borderRadius: RADIUS.lg, border: `1px solid ${SEMANTIC.danger.border}`,
                background: SEMANTIC.danger.bg, color: SEMANTIC.danger.color, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700,
                display: "inline-flex", alignItems: "center", gap: 6, cursor: enCours ? "not-allowed" : "pointer", flexShrink: 0,
              }}><Icon as={Trash2} size={14}/> Annuler cette consigne</button>
            </div>
          ))}
        </section>
        <div ref={finRef}/>
      </div>

      <div style={{ padding: "14px 20px 20px", borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {RACCOURCIS.map(r => (
            <button key={r.libelle} type="button" onClick={() => { setSaisie(r.texte); saisieRef.current?.focus(); }} style={{
              minHeight: 36, padding: "0 12px", borderRadius: RADIUS.pill, border: `1px solid ${T.fieldBorder}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
            }}>{r.libelle}</button>
          ))}
          {messages.length > 0 && (
            <button type="button" onClick={() => { setMessages([]); setResultat(null); setErreurRecalcul(""); }} disabled={enCours} style={{
              minHeight: 36, padding: "0 12px", borderRadius: RADIUS.pill, border: `1px solid ${T.fieldBorder}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}><Icon as={RotateCcw} size={13}/> Nouvelle conversation</button>
          )}
        </div>
        <form onSubmit={e => { e.preventDefault(); envoyer(); }} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="assistant-planning-saisie" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Votre demande</label>
          <input id="assistant-planning-saisie" ref={saisieRef} value={saisie} onChange={e => setSaisie(e.target.value)} disabled={enCours}
            placeholder="Votre demande…" maxLength={1000}
            style={{
              flexGrow: 1, minWidth: 0, minHeight: 48, boxSizing: "border-box", padding: "0 16px", borderRadius: RADIUS.xl,
              border: `1px solid ${T.fieldBorder}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: FONT.md.size, outline: "none",
            }}/>
          <button type="submit" aria-label="Envoyer" disabled={enCours || !saisie.trim()} style={{
            width: 48, height: 48, flexShrink: 0, border: "none", borderRadius: RADIUS.xl, background: acc.accent, color: acc.onAccent,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: enCours ? "wait" : "pointer", opacity: enCours || !saisie.trim() ? 0.55 : 1,
          }}><Icon as={enCours ? Loader2 : ArrowRight} size={20}/></button>
        </form>
      </div>
    </aside>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 970, display: "flex", justifyContent: "flex-end", pointerEvents: "none" }}>
      <style>{"@keyframes assistantPlanningSpin{to{transform:rotate(360deg)}}.assistant-planning-spin{animation:assistantPlanningSpin 1s linear infinite}"}</style>
      {large && (
        <main aria-label="Aperçu du recalcul" style={{ flexGrow: 1, minWidth: 0, height: "100%", overflowY: "auto", background: T.bg, padding: "28px 32px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18, pointerEvents: "auto" }}>
          <GrilleRecalcul apercu={apercu} vue={vue} setVue={setVue} semaines={semaines} setLundi={setLundi} T={T} acc={acc} isMobile={false}/>
          <BandeauFins apercu={apercu} T={T}/>
        </main>
      )}
      <div style={{ height: "100%", width: isMobile ? "100%" : "auto", pointerEvents: "auto", display: "flex" }}>{panneau}</div>
    </div>
  );
}
