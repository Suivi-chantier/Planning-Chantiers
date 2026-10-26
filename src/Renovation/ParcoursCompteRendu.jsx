// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — écrans du NOUVEAU PARCOURS (CR-3), parcours unique
// depuis CR-6 : plus de choix entre deux boutons à l'ouverture, plus d'écran
// final pour les tâches prévues non faites.
//
//   EnteteParcours   la journée attendue, la consigne, dictée et « J'ai fait
//                    autre chose » ; la liste des tâches prévues suit directement
//   PhasageMobileCR  le phasage du chantier : lot › ouvrage › tâche (ou pièce),
//                    recherche, terminées masquées, sélection multiple,
//                    « Créer une tâche » avec une seule question ; en mode
//                    « liaison », une seule tâche pour une ligne du planning
//   BlocLiaison      ligne du planning non liée : la tâche la plus probable
//   BlocCollegue     « Davy a déclaré : … — d'accord ? »
//   FriseHoraire     option de l'ouvrier : heures de changement → durées
//
// Toute la logique vit dans compteRenduV3.mjs et phasageMobileV1.mjs ; ces
// écrans n'écrivent rien en base (RapportMobile envoie, comme avant).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import {
  Check, X, Search, Plus, ChevronRight, ChevronLeft, WifiOff, Layers, Home, ListChecks, Clock, Users, Mic,
} from "lucide-react";
import { LOTS_DEFAUT } from "../constants";
import { BoutonMicro } from "./DicteeCompteRendu";
import {
  MOTIFS_CREATION, phraseCollegue, dureesDepuisFrise, minutesDeHeure,
} from "./compteRenduV3";
import { fmtMinutes } from "./compteRenduV2";
import {
  construireArbre, tachesVisibles, rechercher, parPiece, aFaire, basculerSelection,
} from "./phasageMobileV1";

const SOMBRE = "#1a1f2e";
const COULEUR_ETAT = { pas_commencee: "#94a3b8", en_cours: "#f59e0b", terminee: "#16a34a" };
const LIBELLE_ETAT = { pas_commencee: "Pas commencée", en_cours: "En cours", terminee: "Terminée" };

const gros = (T, fond = SOMBRE, couleur = "#fff") => ({
  width: "100%", minHeight: 64, borderRadius: 18, border: "none", cursor: "pointer", fontFamily: "inherit",
  fontSize: 19, fontWeight: 800, background: fond, color: couleur, display: "flex", alignItems: "center",
  justifyContent: "center", gap: 10, padding: "0 16px",
});
const carte = (T) => ({ background: T.card, borderRadius: 18, padding: "16px 14px", margin: "12px 12px", border: `1px solid ${T.border}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" });

// ── Phasage du chantier : lecture (RPC ouvrier_mes_phases) + copie locale ──
// La copie locale (chargée dès l'ouverture du compte rendu) sert sans réseau.
const clePhasage = (chantierId) => `cr_phasage::${chantierId}`;
export function memoriserPhasage(chantierId, data) {
  try { localStorage.setItem(clePhasage(chantierId), JSON.stringify({ le: Date.now(), data })); } catch { /* plein ou privé */ }
}
export function phasageMemorise(chantierId) {
  try { return JSON.parse(localStorage.getItem(clePhasage(chantierId)) || "null")?.data || null; } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// En-tête du parcours unique (CR-6) : la journée attendue, la consigne, et
// les deux gestes qui ouvrent un autre écran (dictée, « J'ai fait autre
// chose »). La liste des tâches prévues s'affiche juste en dessous, tout de
// suite : il n'y a plus de choix « comme prévu / pas comme prévu ».
export function EnteteParcours({ T, cibleHeures, fmtH, nbPrevues, journeeEtat, onDicter = null, onAutreChose, dicteeFaite = false, children = null }) {
  return (
    <div style={carte(T)}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 6 }}>
        Ta journée
      </div>
      <div style={{ fontSize: 16, color: T.text, marginBottom: 6 }}>
        <Icon as={Clock} size={15}/> {fmtH(cibleHeures)} attendues aujourd'hui
      </div>
      <div style={{ fontSize: 15, color: T.textSub, lineHeight: 1.45 }}>
        {nbPrevues > 0
          ? "Pour chaque tâche prévue, dis où elle en est et ton temps. Le « prévu » écrit en petit n'est qu'un repère."
          : "Rien n'est planifié pour toi aujourd'hui : dis ce que tu as fait."}
      </div>
      {journeeEtat === "indisponible" && nbPrevues > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: T.textSub, fontStyle: "italic" }}>
          <Icon as={WifiOff} size={13}/> Repères du planning indisponibles (connexion) : rien ne change pour toi, dis où en est chaque tâche.
        </div>
      )}
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {onDicter && (
          <button onClick={onDicter} style={{ ...gros(T, T.surface, SOMBRE), minHeight: 56, fontSize: 17, border: `1.5px solid ${T.border}` }}>
            <Icon as={Mic} size={20}/> {dicteeFaite ? "Ma dictée" : "Raconter ma journée au micro"}
          </button>
        )}
        <button onClick={onAutreChose} style={{ ...gros(T, T.surface, SOMBRE), minHeight: 56, fontSize: 17, border: `2px dashed ${T.borderHover}` }}>
          <Icon as={Plus} size={20}/> J'ai fait autre chose
        </button>
      </div>
      {children}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════
// chantiers : [{ id, nom, couleur }] — ceux du jour d'abord.
// dejaChoisies : Set des tache_id déjà dans la journée (choisies ou ajoutées).
export function PhasageMobileCR({
  T, chantiers = [], tousChantiers = [], prenom, aujourdhuiISO, tachesDuJourIds = [], horsConnexion = false,
  dejaChoisies = new Set(), onValider, onCreer, onFermer, champPhotos = null,
  // CR-6 : { texte } = rattacher UNE ligne du planning à une tâche (choix unique).
  modeLiaison = null, creerDirect = false,
}) {
  const [chantierId, setChantierId] = useState(chantiers[0]?.id || "");
  const [charges, setCharges] = useState({});
  const [mode, setMode] = useState("lots");          // lots | pieces
  const [chemin, setChemin] = useState([]);          // [lotId] | [lotId, ouvrageId] | [pieceId]
  const [recherche, setRecherche] = useState("");
  const [montrerTerminees, setMontrerTerminees] = useState(false);
  const [selection, setSelection] = useState([]);    // tache_id
  const [creation, setCreation] = useState(() => (creerDirect ? { ouvrage: null, nom: modeLiaison?.texte || "", motif: null, photos: [] } : null)); // { ouvrage, nom, motif, photos }

  const chantier = chantiers.find(c => c.id === chantierId) || tousChantiers.find(c => c.id === chantierId) || null;
  useEffect(() => {
    if (!chantierId || charges[chantierId]?.etat === "ok") return;
    let annule = false;
    const copie = phasageMemorise(chantierId);
    setCharges(c => ({ ...c, [chantierId]: copie ? { etat: "ok", data: copie, copie: true } : { etat: "chargement" } }));
    if (horsConnexion) { if (!copie) setCharges(c => ({ ...c, [chantierId]: { etat: "erreur" } })); return; }
    (async () => {
      try {
        const { data, error } = await supabase.rpc("ouvrier_mes_phases", {
          p_chantier_id: chantierId, p_prenom: prenom || null, p_aujourdhui: aujourdhuiISO,
        });
        if (annule) return;
        if (error || !data || data.acces_refuse) { if (!copie) setCharges(c => ({ ...c, [chantierId]: { etat: "erreur" } })); return; }
        memoriserPhasage(chantierId, data);
        setCharges(c => ({ ...c, [chantierId]: { etat: "ok", data } }));
      } catch { if (!annule && !copie) setCharges(c => ({ ...c, [chantierId]: { etat: "erreur" } })); }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierId]);

  const charge = charges[chantierId];
  const arbre = useMemo(() => (charge?.etat === "ok"
    ? construireArbre(charge.data, { lotsDefaut: LOTS_DEFAUT, tachesDuJourIds }) : null), [charge, tachesDuJourIds]);
  const tachesParId = useMemo(() => new Map((arbre?.taches || []).map(t => [t.id, t])), [arbre]);
  const choisir = (id) => setSelection(s => (modeLiaison ? (s[0] === id ? [] : [id]) : basculerSelection(s, id)));
  const changerChantier = (id) => { setChantierId(id); setChemin([]); setRecherche(""); };

  const lot = arbre && mode === "lots" && chemin[0] ? arbre.lots.find(l => l.id === chemin[0]) : null;
  const ouvrage = lot && chemin[1] ? lot.ouvrages.find(o => o.id === chemin[1]) : null;
  const piece = arbre && mode === "pieces" && chemin[0] ? parPiece(arbre, { montrerTerminees }).find(p => p.id === chemin[0]) : null;
  const resultats = arbre && recherche.trim() ? rechercher(arbre, recherche, { montrerTerminees }) : null;

  const fil = [
    { label: chantier?.nom || "Chantier", aller: () => setChemin([]) },
    ...(lot ? [{ label: lot.label, aller: () => setChemin([lot.id]) }] : []),
    ...(ouvrage ? [{ label: ouvrage.libelle, aller: () => setChemin([lot.id, ouvrage.id]) }] : []),
    ...(piece ? [{ label: piece.nom, aller: () => setChemin([piece.id]) }] : []),
  ];

  const tuile = (cle, titre, sous, couleur, onClick) => (
    <button key={cle} onClick={onClick} style={{
      width: "100%", textAlign: "left", minHeight: 64, borderRadius: 16, cursor: "pointer", fontFamily: "inherit",
      border: `1.5px solid ${T.border}`, borderLeft: `6px solid ${couleur}`, background: T.surface, color: T.text,
      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 8,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 800, lineHeight: 1.25 }}>{titre}</span>
        {sous && <span style={{ display: "block", fontSize: 13, color: T.textSub, marginTop: 2 }}>{sous}</span>}
      </span>
      <Icon as={ChevronRight} size={20} style={{ color: T.textMuted, flexShrink: 0 }}/>
    </button>
  );
  const ligneTache = (t) => {
    const deja = dejaChoisies.has(t.id);
    const sel = selection.includes(t.id) || deja;
    return (
      <button key={t.id} disabled={deja} onClick={() => choisir(t.id)} aria-pressed={sel} style={{
        width: "100%", textAlign: "left", minHeight: 58, borderRadius: 14, cursor: deja ? "default" : "pointer", fontFamily: "inherit",
        border: `2px solid ${sel ? SOMBRE : T.border}`, background: sel ? "#eef2ff" : T.surface, color: T.text,
        display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", marginBottom: 8, opacity: deja ? 0.6 : 1,
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0, border: `2px solid ${sel ? SOMBRE : T.borderHover}`,
          background: sel ? SOMBRE : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        }}>{sel && <Icon as={Check} size={16} strokeWidth={3}/>}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 16.5, fontWeight: 700, lineHeight: 1.25 }}>{t.nomAffiche}</span>
          {t.nomDevis && t.nomDevis !== t.nomAffiche && (
            <span style={{ display: "block", fontSize: 12, color: T.textMuted }}>{t.nomDevis}</span>
          )}
          {(resultats || mode === "pieces") && (
            <span style={{ display: "block", fontSize: 12.5, color: T.textSub }}>{t.ouvrageLibelle}</span>
          )}
          {deja && <span style={{ display: "block", fontSize: 12.5, color: T.textSub }}>Déjà dans ta journée</span>}
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: COULEUR_ETAT[t.etat], whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: COULEUR_ETAT[t.etat] }}/>
          {LIBELLE_ETAT[t.etat]}
        </span>
      </button>
    );
  };
  const boutonCreer = (o) => (
    <button onClick={() => setCreation({ ouvrage: o ? { id: o.id, libelle: o.libelle } : null, nom: modeLiaison?.texte || "", motif: null, photos: [] })} style={{
      width: "100%", minHeight: 52, borderRadius: 14, border: `2px dashed ${T.borderHover}`, background: "transparent",
      color: T.text, fontFamily: "inherit", fontSize: 16, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4,
    }}><Icon as={Plus} size={18}/> Créer une tâche{o ? " ici" : ""}</button>
  );

  // ── Écran « Créer une tâche » : une seule question ─────────────────────────
  if (creation) {
    const ouvragesChantier = (arbre?.lots || []).flatMap(l => l.ouvrages);
    const pret = creation.nom.trim() && creation.motif && (creation.motif !== "demande_client" || (creation.photos || []).length > 0);
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: T.bg, overflowY: "auto" }}>
        <div style={{ background: "#16181d", padding: "14px 16px", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setCreation(null)} aria-label="Retour" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}><Icon as={ChevronLeft} size={24}/></button>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Créer une tâche</div>
        </div>
        <div style={carte(T)}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Ce que tu as fait</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={creation.nom} onChange={e => setCreation(c => ({ ...c, nom: e.target.value }))} placeholder="Ex. : reprise de l'angle du couloir" style={{
              flex: 1, minWidth: 0, boxSizing: "border-box", minHeight: 52, borderRadius: 12, border: `1.5px solid ${T.border}`, padding: "0 12px", fontSize: 17, fontFamily: "inherit",
            }}/>
            <BoutonMicro T={T} valeur={creation.nom} onChange={v => setCreation(c => ({ ...c, nom: v }))} taille={52}/>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, margin: "14px 0 6px" }}>Dans quel ouvrage ?</div>
          <select value={creation.ouvrage?.id || ""} onChange={e => {
            const o = ouvragesChantier.find(x => x.id === e.target.value);
            setCreation(c => ({ ...c, ouvrage: o ? { id: o.id, libelle: o.libelle } : null }));
          }} style={{ width: "100%", minHeight: 52, borderRadius: 12, border: `1.5px solid ${T.border}`, fontSize: 16, fontFamily: "inherit", padding: "0 10px", background: T.surface }}>
            <option value="">Divers / hors devis</option>
            {ouvragesChantier.map(o => <option key={o.id} value={o.id}>{o.libelle}</option>)}
          </select>
          <div style={{ fontSize: 15, fontWeight: 800, margin: "14px 0 6px" }}>Pourquoi elle n'est pas dans la liste ?</div>
          <div style={{ display: "grid", gap: 8 }}>
            {MOTIFS_CREATION.map(m => {
              const sel = creation.motif === m.code;
              return (
                <button key={m.code} onClick={() => setCreation(c => ({ ...c, motif: m.code }))} aria-pressed={sel} style={{
                  minHeight: 54, borderRadius: 14, cursor: "pointer", fontFamily: "inherit", fontSize: 17, fontWeight: 800,
                  border: `2px solid ${sel ? SOMBRE : T.border}`, background: sel ? SOMBRE : T.surface, color: sel ? "#fff" : T.text,
                }}>{m.label}</button>
              );
            })}
          </div>
          {creation.motif === "demande_client" && champPhotos && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Une photo est demandée pour une demande du client</div>
              {champPhotos(creation.photos || [], (arr) => setCreation(c => ({ ...c, photos: arr })))}
            </div>
          )}
        </div>
        <div style={{ padding: "4px 12px 24px" }}>
          <button disabled={!pret} onClick={() => { onCreer(creation, chantier); setCreation(null); }} style={{ ...gros(T, pret ? T.accent : T.border, SOMBRE), opacity: pret ? 1 : 0.6 }}>
            <Icon as={Check} size={20}/> {modeLiaison ? "Créer la tâche (heures gardées)" : "Ajouter à ma journée"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: T.bg, overflowY: "auto", paddingBottom: 96 }}>
      <div style={{ background: "#16181d", padding: "14px 16px", color: "#fff", position: "sticky", top: 0, zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onFermer} aria-label="Fermer" style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}><Icon as={X} size={24}/></button>
          <div style={{ fontSize: 19, fontWeight: 800, flex: 1 }}>{modeLiaison ? "C'est quelle tâche ?" : "Qu'as-tu fait aujourd'hui ?"}</div>
        </div>
        {modeLiaison && (
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>Au planning : « {modeLiaison.texte} » — ses heures sont gardées.</div>
        )}
        <div style={{ position: "relative", marginTop: 10 }}>
          <Icon as={Search} size={18} style={{ position: "absolute", left: 12, top: 15, color: T.textMuted }}/>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Chercher une tâche dans tout le chantier" style={{
              flex: 1, minWidth: 0, boxSizing: "border-box", minHeight: 48, borderRadius: 12, border: "none", padding: "0 12px 0 38px", fontSize: 16, fontFamily: "inherit",
            }}/>
            <BoutonMicro T={T} valeur={recherche} onChange={setRecherche} taille={48} fond="#fff" couleur={SOMBRE}/>
          </div>
        </div>
      </div>

      {(chantiers.length > 1 || tousChantiers.length > 0) && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 12px 0" }}>
          {[...chantiers, ...tousChantiers.filter(c => !chantiers.some(x => x.id === c.id))].map(c => (
            <button key={c.id} onClick={() => changerChantier(c.id)} style={{
              flexShrink: 0, minHeight: 40, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700,
              border: `1.5px solid ${c.id === chantierId ? SOMBRE : T.border}`, background: c.id === chantierId ? SOMBRE : T.surface, color: c.id === chantierId ? "#fff" : T.text,
            }}>{c.nom}</button>
          ))}
        </div>
      )}

      <div style={{ padding: "10px 12px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {[{ id: "lots", label: "Par lot", icon: Layers }, { id: "pieces", label: "Par pièce", icon: Home }].map(m => (
          <button key={m.id} onClick={() => { setMode(m.id); setChemin([]); }} style={{
            minHeight: 40, padding: "0 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 800,
            border: `1.5px solid ${mode === m.id ? SOMBRE : T.border}`, background: mode === m.id ? "#eef2ff" : T.surface, color: T.text,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}><Icon as={m.icon} size={15}/> {m.label}</button>
        ))}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: T.textSub, marginLeft: "auto" }}>
          <input type="checkbox" checked={montrerTerminees} onChange={e => setMontrerTerminees(e.target.checked)}/> Voir les terminées
        </label>
      </div>

      {!resultats && fil.length > 1 && (
        <div style={{ padding: "10px 12px 0", display: "flex", flexWrap: "wrap", gap: 4, fontSize: 14, color: T.textSub }}>
          {fil.map((f, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <Icon as={ChevronRight} size={13}/>}
              <button onClick={f.aller} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: i === fil.length - 1 ? 800 : 600, color: i === fil.length - 1 ? T.text : T.info }}>{f.label}</button>
            </span>
          ))}
        </div>
      )}

      <div style={{ padding: "10px 12px" }}>
        {charge?.copie && (
          <div style={{ fontSize: 13, color: T.textSub, marginBottom: 8 }}><Icon as={WifiOff} size={13}/> Phasage enregistré sur ton téléphone{horsConnexion ? " (pas de réseau)" : ""}.</div>
        )}
        {(!charge || charge.etat === "chargement") && <div style={{ fontSize: 15, color: T.textSub }}>Chargement du phasage…</div>}
        {charge?.etat === "erreur" && (
          <div style={{ fontSize: 15, color: T.text, lineHeight: 1.5 }}>
            Le phasage de ce chantier n'a pas pu être lu{horsConnexion ? " (pas de réseau, et il n'était pas encore enregistré sur ton téléphone)" : ""}.
            Tu peux quand même créer une tâche.
            {boutonCreer(null)}
          </div>
        )}
        {arbre && resultats && (
          <>
            {resultats.length === 0 && <div style={{ fontSize: 15, color: T.textSub, marginBottom: 8 }}>Aucune tâche ne correspond.</div>}
            {resultats.map(ligneTache)}
            {boutonCreer(null)}
          </>
        )}
        {arbre && !resultats && mode === "lots" && !lot && (
          <>
            {arbre.lots.map(l => {
              const n = aFaire(l.ouvrages.flatMap(o => o.taches));
              return tuile(l.id, l.label, `${n} tâche${n > 1 ? "s" : ""} à faire${l.prioritaire ? " · ton métier" : ""}`, l.couleur, () => setChemin([l.id]));
            })}
            {boutonCreer(null)}
          </>
        )}
        {arbre && !resultats && lot && !ouvrage && (
          <>
            {lot.ouvrages.filter(o => montrerTerminees || aFaire(o.taches) > 0).map(o => {
              const n = aFaire(o.taches);
              return tuile(o.id, o.libelle, `${n} à faire${o.libelleDevis && o.libelleDevis !== o.libelle ? ` · ${o.libelleDevis}` : ""}`, lot.couleur, () => setChemin([lot.id, o.id]));
            })}
            {boutonCreer(null)}
          </>
        )}
        {arbre && !resultats && ouvrage && (
          <>
            {tachesVisibles(ouvrage.taches, { montrerTerminees }).map(ligneTache)}
            {tachesVisibles(ouvrage.taches, { montrerTerminees }).length === 0 && (
              <div style={{ fontSize: 15, color: T.textSub, marginBottom: 8 }}>Toutes les tâches de cet ouvrage sont terminées.</div>
            )}
            {boutonCreer(ouvrage)}
          </>
        )}
        {arbre && !resultats && mode === "pieces" && !piece && (
          <>
            {parPiece(arbre, { montrerTerminees }).map(p => tuile(p.id, p.nom, `${p.taches.length} tâche${p.taches.length > 1 ? "s" : ""}`, "#64748b", () => setChemin([p.id])))}
            {arbre.pieces.length === 0 && <div style={{ fontSize: 14, color: T.textSub, marginBottom: 8 }}>Pas encore de pièces sur ce chantier : tout est dans « Sans pièce ».</div>}
            {boutonCreer(null)}
          </>
        )}
        {arbre && !resultats && piece && (
          <>
            {piece.taches.map(ligneTache)}
            {boutonCreer(null)}
          </>
        )}
      </div>

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, padding: "10px 12px 16px", background: T.bg, borderTop: `1px solid ${T.border}`, zIndex: 3 }}>
        <button disabled={selection.length === 0} onClick={() => onValider(selection.map(id => tachesParId.get(id)).filter(Boolean), chantier)} style={{
          ...gros(T, selection.length ? T.accent : T.border, SOMBRE), opacity: selection.length ? 1 : 0.6,
        }}>
          <Icon as={ListChecks} size={20}/> {modeLiaison
            ? (selection.length === 0 ? "Choisis la tâche" : "Choisir cette tâche")
            : selection.length === 0 ? "Choisis tes tâches" : `${selection.length} tâche${selection.length > 1 ? "s" : ""} choisie${selection.length > 1 ? "s" : ""} → Ajouter à ma journée`}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Ligne du planning non liée à une tâche du phasage (CR-6) : la proposition
// la plus probable en tête (nom, lot, ouvrage), « Choisir dans le phasage »,
// ou « Créer une tâche ». Rien n'est rattaché sans geste de l'ouvrier.
//   proposition : propositionsLiaison(...)[0] ou null ; etat : ok | chargement | indisponible
export function BlocLiaison({ T, proposition = null, etat = "ok", onAccepter, onChoisir, onCreer }) {
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: "#fff7ed", border: "1.5px solid #fed7aa" }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: SOMBRE, lineHeight: 1.35 }}>
        Cette ligne du planning n'est reliée à aucune tâche du phasage. C'est laquelle ?
      </div>
      {etat === "chargement" && <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 6 }}>Recherche de la tâche la plus probable…</div>}
      {etat === "indisponible" && (
        <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 6 }}>
          <Icon as={WifiOff} size={13}/> Phasage du chantier indisponible pour l'instant : tu peux envoyer quand même, le conducteur la rattachera.
        </div>
      )}
      {proposition && (
        <button onClick={onAccepter} style={{
          width: "100%", textAlign: "left", marginTop: 8, minHeight: 56, borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          border: `2px solid #166534`, background: "#f0fdf4", color: T.text, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <Icon as={Check} size={20} strokeWidth={2.8} style={{ color: "#166534", flexShrink: 0 }}/>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#166534", textTransform: "uppercase", letterSpacing: 0.3 }}>La plus probable</span>
            <span style={{ display: "block", fontSize: 16.5, fontWeight: 800, lineHeight: 1.25 }}>{proposition.nom}</span>
            <span style={{
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              fontSize: 12.5, color: T.textSub, lineHeight: 1.35,
            }}>{[proposition.lot, proposition.ouvrage, proposition.piece].filter(Boolean).join(" › ")}</span>
          </span>
        </button>
      )}
      {!proposition && etat === "ok" && (
        <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 6 }}>Aucune tâche du phasage ne ressemble à ce nom : choisis-la ou crée-la.</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <button onClick={onChoisir} style={{ minHeight: 46, borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.surface, color: T.text, fontFamily: "inherit", fontSize: 14.5, fontWeight: 800, cursor: "pointer" }}>
          Choisir dans le phasage
        </button>
        <button onClick={onCreer} style={{ minHeight: 46, borderRadius: 12, border: `1.5px dashed ${T.borderHover}`, background: T.surface, color: T.text, fontFamily: "inherit", fontSize: 14.5, fontWeight: 800, cursor: "pointer" }}>
          Créer une tâche
        </button>
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════
// declarations : celles des collègues pour CETTE tâche ; t.collegue = réponse déjà donnée.
export function BlocCollegue({ T, t, declarations, onAccord, onDesaccord }) {
  if (!declarations?.length) return null;
  const d = declarations[declarations.length - 1];
  const repondu = t.collegue && t.collegue.ouvrier === d.ouvrier;
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: "#eef6ff", border: "1.5px solid #bfdbfe" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 15, fontWeight: 800, color: SOMBRE }}>
        <Icon as={Users} size={17} style={{ flexShrink: 0, marginTop: 1 }}/> {phraseCollegue(d, t.planifie)}{repondu ? "" : " — d'accord ?"}
      </div>
      {repondu ? (
        <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 6 }}>
          {t.collegue.accord ? "Tu es d'accord : ajoute seulement ton temps." : "Pas d'accord : indique ton état, le conducteur tranchera."}
          {" "}<button onClick={t.collegue.accord ? onDesaccord : onAccord} style={{ background: "transparent", border: "none", padding: 0, color: T.info, fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Changer</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <button onClick={onAccord} style={{ minHeight: 48, borderRadius: 12, border: "none", background: "#166534", color: "#fff", fontFamily: "inherit", fontSize: 15.5, fontWeight: 800, cursor: "pointer" }}>Oui, d'accord</button>
          <button onClick={onDesaccord} style={{ minHeight: 48, borderRadius: 12, border: `2px solid ${T.border}`, background: T.surface, color: T.text, fontFamily: "inherit", fontSize: 15.5, fontWeight: 800, cursor: "pointer" }}>Non, autre état</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// lignes : [{ idx, nom }] (tâches avec du temps) ; onAppliquer(durees par idx).
export function FriseHoraire({ T, lignes, cibleHeures, onAppliquer, onFermer }) {
  const departDefaut = (() => {
    const fin = minutesDeHeure("07:30") + Math.round((Number(cibleHeures) || 0) * 60) + 30;
    return `${String(Math.floor(fin / 60) % 24).padStart(2, "0")}:${String(fin % 60).padStart(2, "0")}`;
  })();
  const [arrivee, setArrivee] = useState("07:30");
  const [depart, setDepart] = useState(departDefaut);
  const [pause, setPause] = useState({ debut: "12:00", fin: "12:30" });
  const [segments, setSegments] = useState(() => lignes.map((l, i) => ({ cle: l.idx, debut: i === 0 ? "07:30" : "" })));
  const res = dureesDepuisFrise({ arrivee, depart, pause, segments });
  const champ = { minHeight: 44, borderRadius: 10, border: `1.5px solid ${T.border}`, fontSize: 16, fontFamily: "inherit", padding: "0 8px" };
  return (
    <div style={{ ...carte(T), border: `2px solid ${T.info}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 8 }}>
        <Icon as={Clock} size={17}/> Frise horaire <button onClick={onFermer} style={{ marginLeft: "auto", background: "transparent", border: "none", color: T.textSub, cursor: "pointer" }}><Icon as={X} size={18}/></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14, color: T.textSub }}>
        <label>Arrivée<br/><input type="time" value={arrivee} onChange={e => { setArrivee(e.target.value); setSegments(s => s.map((x, i) => (i === 0 ? { ...x, debut: e.target.value } : x))); }} style={champ}/></label>
        <label>Départ<br/><input type="time" value={depart} onChange={e => setDepart(e.target.value)} style={champ}/></label>
        <label>Pause de<br/><input type="time" value={pause.debut} onChange={e => setPause(p => ({ ...p, debut: e.target.value }))} style={champ}/></label>
        <label>à<br/><input type="time" value={pause.fin} onChange={e => setPause(p => ({ ...p, fin: e.target.value }))} style={champ}/></label>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: T.text, margin: "12px 0 6px" }}>À quelle heure as-tu commencé chaque tâche ?</div>
      {segments.map((s, i) => (
        <div key={s.cle} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <input type="time" value={s.debut} onChange={e => setSegments(arr => arr.map((x, k) => (k === i ? { ...x, debut: e.target.value } : x)))} style={{ ...champ, width: 110 }}/>
          <span style={{ flex: 1, fontSize: 15, color: T.text }}>{lignes[i]?.nom}</span>
          <span style={{ fontSize: 14, color: T.textSub, whiteSpace: "nowrap" }}>{res.durees[s.cle] != null ? fmtMinutes(res.durees[s.cle]) : "—"}</span>
        </div>
      ))}
      {res.erreurs.length > 0 && <div style={{ fontSize: 13.5, color: T.danger, fontWeight: 700, marginTop: 6 }}>{res.erreurs.join(" ; ")}</div>}
      <button disabled={res.erreurs.length > 0} onClick={() => onAppliquer(res.durees)} style={{ ...gros(T, res.erreurs.length ? T.border : SOMBRE), minHeight: 52, fontSize: 16, marginTop: 10 }}>
        Mettre ces durées ({fmtMinutes(res.total)})
      </button>
    </div>
  );
}
