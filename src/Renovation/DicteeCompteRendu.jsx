// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — DICTÉE et PRÉREMPLISSAGE PAR L'IA (CR-4).
//
//   useReconnaissanceVocale  micro du navigateur (Web Speech API), en français
//   BoutonMicro              petit micro à côté d'un champ (recherche du
//                            phasage, nom d'une tâche créée, remarque)
//   EcranDictee              « Raconte ta journée » : texte dicté, analyse par
//                            l'IA, résumé à relire, puis « Utiliser »
//
// Transcription : la reconnaissance vocale du NAVIGATEUR (gratuite, sans
// nouveau service). Quand elle n'existe pas ou échoue (certains iPhone en
// application installée, pas de réseau), l'ouvrier dicte avec le micro de
// son CLAVIER dans le même champ texte : rien n'est perdu.
// Toute la logique vit dans dicteeCrV1.mjs ; ces écrans n'écrivent rien en
// base (RapportMobile envoie, comme avant).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../ui";
import { Mic, MicOff, Check, X, ChevronLeft, WifiOff, Sparkles, ShoppingCart, Plus } from "lucide-react";
import {
  ajouterTranscription, propositionsCertaines, suggestionsIncertaines, libelleProposition, TEXTE_MIN,
} from "./dicteeCrV1";

const SOMBRE = "#1a1f2e";
const carte = (T) => ({ background: T.card, borderRadius: 18, padding: "16px 14px", margin: "12px 12px", border: `1px solid ${T.border}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" });
const gros = (fond, couleur = "#fff") => ({
  width: "100%", minHeight: 60, borderRadius: 18, border: "none", cursor: "pointer", fontFamily: "inherit",
  fontSize: 18, fontWeight: 800, background: fond, color: couleur, display: "flex", alignItems: "center",
  justifyContent: "center", gap: 10, padding: "0 16px",
});

const Reconnaissance = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);
export const micNavigateurDisponible = () => !!Reconnaissance();

// onFinal(morceau) est appelé pour chaque phrase reconnue (texte définitif).
export function useReconnaissanceVocale(onFinal) {
  const [ecoute, setEcoute] = useState(false);
  const [provisoire, setProvisoire] = useState("");
  const [erreur, setErreur] = useState(null);
  const rec = useRef(null);
  const rappel = useRef(onFinal);
  rappel.current = onFinal;
  useEffect(() => () => { try { rec.current?.abort(); } catch { /* déjà arrêté */ } }, []);
  const demarrer = () => {
    const R = Reconnaissance();
    if (!R) { setErreur("indisponible"); return; }
    try {
      const r = new R();
      r.lang = "fr-FR"; r.continuous = true; r.interimResults = true;
      r.onresult = (ev) => {
        let prov = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) rappel.current?.(res[0].transcript);
          else prov += res[0].transcript;
        }
        setProvisoire(prov);
      };
      r.onerror = (ev) => { setErreur(ev?.error || "erreur"); };
      r.onend = () => { setEcoute(false); setProvisoire(""); };
      rec.current = r;
      setErreur(null);
      r.start();
      setEcoute(true);
    } catch { setErreur("erreur"); setEcoute(false); }
  };
  const arreter = () => { try { rec.current?.stop(); } catch { /* déjà arrêté */ } setEcoute(false); };
  return { disponible: micNavigateurDisponible(), ecoute, provisoire, erreur, demarrer, arreter };
}

const MESSAGES_ERREUR = {
  "not-allowed": "Le micro est refusé : autorise-le dans les réglages du téléphone, ou utilise le micro de ton clavier.",
  "service-not-allowed": "Le micro de l'application n'est pas disponible sur ce téléphone : utilise le micro de ton clavier.",
  network: "Pas de réseau pour le micro : utilise le micro de ton clavier, l'analyse se fera plus tard.",
  "no-speech": "Je n'ai rien entendu : réessaie en parlant près du téléphone.",
  indisponible: "Pas de micro dans ce navigateur : utilise le micro de ton clavier.",
};
export const messageErreurMicro = (code) => (code && code !== "aborted" ? MESSAGES_ERREUR[code] || "Le micro s'est arrêté : réessaie, ou utilise le micro de ton clavier." : null);

// Petit micro à côté d'un champ : ajoute ce qui est dit au texte du champ.
// Masqué quand le navigateur n'a pas de reconnaissance vocale (le micro du
// clavier reste disponible dans le champ).
export function BoutonMicro({ T, valeur, onChange, taille = 44, fond = "transparent", couleur }) {
  const courant = useRef(valeur);
  courant.current = valeur;
  const { disponible, ecoute, demarrer, arreter } = useReconnaissanceVocale(m => onChange(ajouterTranscription(courant.current, m)));
  if (!disponible) return null;
  return (
    <button type="button" onClick={ecoute ? arreter : demarrer} aria-label={ecoute ? "Arrêter la dictée" : "Dicter"} aria-pressed={ecoute} style={{
      width: taille, height: taille, minWidth: taille, borderRadius: 12, border: `1.5px solid ${ecoute ? "#dc2626" : T.border}`,
      background: ecoute ? "#fee2e2" : fond, color: ecoute ? "#dc2626" : couleur || T.text, cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <Icon as={ecoute ? MicOff : Mic} size={Math.round(taille * 0.45)}/>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// texte, source : le texte raconté (toujours conservé tel quel) et d'où il
//   vient (« micro » du navigateur, ou « clavier »).
// analyse : { etat: "attente" | "encours" | "ok" | "erreur", sortie, message }
// candidats : Map(tache_id → { tache, chantier }) pour nommer les propositions.
// onAppliquer({ propositions, remarque, materiel }) : l'ouvrier accepte.
export function EcranDictee({
  T, texte, onTexte, analyse, candidats, horsConnexion = false, onAnalyser, onAppliquer, onCommander, onFermer,
}) {
  const courant = useRef(texte);
  courant.current = texte;
  const { disponible, ecoute, provisoire, erreur, demarrer, arreter } = useReconnaissanceVocale(
    m => onTexte(ajouterTranscription(courant.current, m), "micro"));
  const sortie = analyse?.etat === "ok" ? analyse.sortie : null;
  const sures = propositionsCertaines(sortie);
  const incertaines = suggestionsIncertaines(sortie);
  const [retenues, setRetenues] = useState([]);   // tache_id des suggestions touchées
  const [remarque, setRemarque] = useState("");
  useEffect(() => { setRetenues([]); setRemarque(sortie?.remarque || ""); }, [sortie]);
  const assezLong = String(texte || "").trim().length >= TEXTE_MIN;
  const msgMicro = messageErreurMicro(erreur);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 990, background: T.bg, overflowY: "auto", paddingBottom: 40 }}>
      <div style={{ background: "#16181d", padding: "14px 16px", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => { arreter(); onFermer(); }} aria-label="Retour" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}><Icon as={ChevronLeft} size={24}/></button>
        <div style={{ fontSize: 19, fontWeight: 800 }}>Raconte ta journée</div>
      </div>

      <div style={carte(T)}>
        <div style={{ fontSize: 15, color: T.textSub, lineHeight: 1.45, marginBottom: 10 }}>
          Dis en quelques phrases ce que tu as fait, ce qui manque, ce qui bloque.
          Par exemple : « J'ai fini le placo de la chambre, commencé les bandes dans la salle de bain, il manque des vis de 25. »
        </div>
        {disponible && (
          <button onClick={ecoute ? arreter : demarrer} style={gros(ecoute ? "#dc2626" : SOMBRE)}>
            <Icon as={ecoute ? MicOff : Mic} size={26}/> {ecoute ? "J'ai fini de parler" : "Appuie et parle"}
          </button>
        )}
        {ecoute && provisoire && (
          <div style={{ marginTop: 8, fontSize: 15, color: T.textSub, fontStyle: "italic" }}>{provisoire}…</div>
        )}
        {msgMicro && <div style={{ marginTop: 8, fontSize: 14, color: "#b45309", fontWeight: 700 }}>{msgMicro}</div>}
        <textarea value={texte} onChange={e => onTexte(e.target.value, "clavier")} rows={6}
          placeholder={disponible ? "Ton texte s'écrit ici. Tu peux aussi le corriger au clavier." : "Appuie sur le micro 🎤 de ton clavier et parle : ton texte s'écrit ici."}
          style={{ width: "100%", boxSizing: "border-box", marginTop: 10, borderRadius: 12, border: `1.5px solid ${T.border}`, padding: 12, fontSize: 16, fontFamily: "inherit", lineHeight: 1.45, background: T.surface, color: T.text }}/>
        {!disponible && (
          <div style={{ fontSize: 13, color: T.textSub, marginTop: 6 }}>
            Ce téléphone n'a pas le micro de l'application : la touche 🎤 du clavier fait la même chose.
          </div>
        )}
      </div>

      {analyse?.etat !== "ok" && (
        <div style={{ padding: "0 12px", display: "grid", gap: 10 }}>
          {horsConnexion ? (
            <div style={{ ...carte(T), margin: 0, fontSize: 15, color: T.text, lineHeight: 1.45 }}>
              <Icon as={WifiOff} size={15}/> Pas de réseau : ton texte est gardé. Remplis ton compte rendu à la main ;
              ta remarque sera remise au propre à l'envoi, et ton texte d'origine reste joint.
            </div>
          ) : (
            <button disabled={!assezLong || analyse?.etat === "encours"} onClick={() => { arreter(); onAnalyser(); }}
              style={{ ...gros("#166534"), opacity: !assezLong || analyse?.etat === "encours" ? 0.5 : 1 }}>
              <Icon as={Sparkles} size={22}/> {analyse?.etat === "encours" ? "Je prépare ton compte rendu…" : "Préparer mon compte rendu"}
            </button>
          )}
          {analyse?.etat === "erreur" && (
            <div style={{ ...carte(T), margin: 0, fontSize: 15, color: "#b45309", fontWeight: 700, lineHeight: 1.45 }}>
              {analyse.message || "La préparation automatique n'a pas marché."} Ton texte est gardé : remplis ton compte rendu à la main, il sera joint.
            </div>
          )}
          <button onClick={() => { arreter(); onFermer(); }} style={gros(T.surface, SOMBRE)}>
            Remplir moi-même
          </button>
        </div>
      )}

      {sortie && (
        <>
          <div style={carte(T)}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>
              Ce que j'ai compris
            </div>
            {sures.length === 0 && (
              <div style={{ fontSize: 15, color: T.textSub, lineHeight: 1.45 }}>
                {sortie.ambigu ? "Ton texte n'est pas assez clair pour remplir les tâches à ta place : tu les choisiras toi-même." : "Aucune tâche reconnue avec certitude : tu les choisiras toi-même."}
              </div>
            )}
            {sures.map(p => (
              <div key={p.tache_id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderTop: `1px solid ${T.border}`, fontSize: 16, color: T.text }}>
                <Icon as={Check} size={18} style={{ color: "#166534", flexShrink: 0, marginTop: 2 }}/>
                <span style={{ fontWeight: 700 }}>{libelleProposition(p, candidats)}</span>
              </div>
            ))}
            {incertaines.length > 0 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.textSub, margin: "12px 0 6px" }}>Pas sûr — touche pour ajouter :</div>
                {incertaines.map(p => {
                  const on = retenues.includes(p.tache_id);
                  return (
                    <button key={p.tache_id} onClick={() => setRetenues(r => (on ? r.filter(x => x !== p.tache_id) : [...r, p.tache_id]))} aria-pressed={on} style={{
                      width: "100%", textAlign: "left", minHeight: 50, borderRadius: 12, marginBottom: 6, cursor: "pointer", fontFamily: "inherit",
                      border: `2px solid ${on ? SOMBRE : T.border}`, background: on ? "#eef2ff" : T.surface, color: T.text, fontSize: 15, padding: "8px 12px",
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <Icon as={on ? Check : Plus} size={16}/> {libelleProposition(p, candidats)}
                    </button>
                  );
                })}
              </>
            )}
          </div>

          <div style={carte(T)}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Ta remarque, remise au propre</div>
            <textarea value={remarque} onChange={e => setRemarque(e.target.value)} rows={3} placeholder="Rien à signaler"
              style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: `1.5px solid ${T.border}`, padding: 10, fontSize: 15.5, fontFamily: "inherit", lineHeight: 1.45, background: T.surface, color: T.text }}/>
            <div style={{ fontSize: 13, color: T.textSub, marginTop: 4 }}>Ton texte d'origine est gardé et joint au compte rendu.</div>
          </div>

          {(sortie.materiel || []).length > 0 && (
            <div style={carte(T)}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Matériel à demander</div>
              {sortie.materiel.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: i ? `1px solid ${T.border}` : "none" }}>
                  <span style={{ flex: 1, fontSize: 15.5, color: T.text }}>{m.texte}</span>
                  {onCommander && (
                    <button onClick={() => onCommander(m)} style={{ minHeight: 44, borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.surface, color: T.text, padding: "0 12px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Icon as={ShoppingCart} size={15}/> Demander
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ padding: "0 12px", display: "grid", gap: 10 }}>
            <button onClick={() => onAppliquer({
              propositions: [...sures, ...incertaines.filter(p => retenues.includes(p.tache_id))],
              remarque,
            })} style={gros("#166534")}>
              <Icon as={Check} size={22}/> Utiliser et vérifier
            </button>
            <button onClick={onFermer} style={gros(T.surface, SOMBRE)}>
              <Icon as={X} size={18}/> Ne rien utiliser, remplir moi-même
            </button>
            <div style={{ fontSize: 13.5, color: T.textSub, textAlign: "center", lineHeight: 1.4 }}>
              Rien n'est envoyé maintenant : tu vérifies chaque tâche et ton temps, puis tu envoies toi-même.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
