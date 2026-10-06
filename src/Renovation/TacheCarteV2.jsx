// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir, formulaire BÊTA « cr_v2 » — une carte par tâche.
//
// Toute la logique (statuts, minutes, motifs, dépassement) vit dans le module
// pur compteRenduV2.mjs ; cette carte ne fait qu'afficher et appeler ses
// fonctions. Elle ne lit rien en base : les infos de la tâche (chemin
// Phase › Ouvrage, heures vendues / validées / en attente, dernier motif de
// dépassement) arrivent de RapportMobile, qui les charge via la RPC
// ouvrier_mes_phases.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect } from "react";
import { Icon } from "../ui";
import {
  Check, RotateCw, Pause, Ban, Minus, Plus, Trash2, ShoppingCart, ChevronRight, Hourglass, History,
} from "lucide-react";
import {
  CHOIX, PAS_MINUTES, choixDeLigne, appliquerChoix, changerMinutes, minutesDe, fmtMinutes,
  ajustementPossible, poserReste, etatAvecAujourdhui, motifDepassementRequis, problemesLigne,
  LIBELLES_PROBLEMES,
} from "./compteRenduV2";
import {
  MOTIFS_STATUT, MOTIFS_DEPASSEMENT, CODE_MOTIF_AUTRE, libelleMotifDepassement,
} from "./motifsCompteRendu";
import { Pastille } from "./OuvrierMesPhases";

const SOMBRE = "#1a1f2e";
const fmtH = (h) => fmtMinutes(Math.round(h * 60));
const dateCourte = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

const STATUTS_GRILLE = [
  { id: "pas_commence", icon: Ban },
  { id: "en_cours",     icon: RotateCw },
  { id: "termine",      icon: Check },
  { id: "bloque",       icon: Pause },
];

function Pastilles({ options, valeur, onChoisir, T }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map(m => {
        const sel = valeur === m.code;
        return (
          <button key={m.code} onClick={() => onChoisir(m.code)} aria-pressed={sel} style={{
            minHeight: 44, padding: "0 14px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
            fontSize: 15, fontWeight: 700, border: `2px solid ${sel ? SOMBRE : T.border}`,
            background: sel ? SOMBRE : T.surface, color: sel ? "#fff" : T.text,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {sel && <Icon as={Check} size={14} strokeWidth={3}/>}
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export default function TacheCarteV2({
  t, info, infosEtat, resteMin, onMaj, onSupprimer, chantiers = [], onOuvrirCommande, T, photos,
}) {
  const choix = choixDeLigne(t);
  const min = minutesDe(t);
  const avancementActuel = info?.avancement ?? null;
  const suivi = etatAvecAujourdhui(info, t);
  const requis = motifDepassementRequis(info, t);
  const dernier = info?.dernier_motif_depassement || null;
  const problemes = problemesLigne(t, info && t.tache_id ? { [String(t.tache_id)]: info } : {});

  // Motif de dépassement déjà donné pour cette tâche : repris d'office, mais
  // VISIBLEMENT (phrase « Déjà indiqué le… ») et changeable d'un tap. Une fois
  // que l'ouvrier a choisi lui-même, on ne repropose plus.
  useEffect(() => {
    if (requis && !t.motif_depassement && dernier?.code && !t.motif_depassement_choisi) {
      onMaj(x => ({ ...x, motif_depassement: dernier.code, motif_depassement_repris: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requis, dernier?.code]);

  const btnPasStyle = (actif) => ({
    width: 52, height: 52, borderRadius: 14, border: `1.5px solid ${T.border}`,
    background: actif ? T.surface : T.bg, color: actif ? SOMBRE : T.textMuted, cursor: actif ? "pointer" : "not-allowed",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  });

  const chemin = [info?.phase_nom, info?.ouvrage_libelle].filter(Boolean).join(" › ");
  const tempsActif = choix !== "pas_commence";

  return (
    <div style={{ padding: "14px 14px 16px", borderTop: `1px solid ${T.border}` }}>
      {/* En-tête : chemin, nom, durée prévue */}
      {/* Les libellés d'ouvrage viennent du devis et peuvent faire un paragraphe :
          deux lignes au plus, le texte entier au survol / appui long. */}
      {chemin && (
        <div title={chemin} style={{
          fontSize: 12.5, color: T.textSub, marginBottom: 2, lineHeight: 1.35,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{chemin}</div>
      )}
      {t.libre ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {chantiers.map(c => {
              const sel = t.chantier_id === c.id;
              return (
                <button key={c.id} onClick={() => onMaj(x => ({ ...x, chantier_id: c.id, chantier_nom: c.nom || "", chantier_couleur: c.couleur || "#c8d8f0" }))} style={{
                  minHeight: 40, padding: "0 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                  fontSize: 14, fontWeight: 700, border: `1.5px solid ${sel ? c.couleur : T.border}`,
                  background: sel ? `${c.couleur}33` : T.surface, color: T.text,
                }}>{c.nom}</button>
              );
            })}
          </div>
          <textarea value={t.planifie} onChange={e => onMaj(x => ({ ...x, planifie: e.target.value }))}
            placeholder="Décris la tâche…" style={{
              width: "100%", boxSizing: "border-box", minHeight: 56, resize: "none", fontSize: 16, fontFamily: "inherit",
              border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8,
            }}/>
        </>
      ) : (
        <div style={{ fontSize: 19, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>{t.planifie}</div>
      )}
      {t.heures_prevues > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: T.textSub, marginTop: 3 }}>
          <Icon as={Hourglass} size={13}/> Prévu au planning : {fmtH(t.heures_prevues)}
        </div>
      )}

      {/* Temps passé : − / + par quart d'heure, aucun clavier */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>Temps passé</div>
          {!tempsActif && <div style={{ fontSize: 12.5, color: T.textSub }}>Pas commencé : 0 h</div>}
        </div>
        <button aria-label="Retirer 15 minutes" disabled={!tempsActif || min <= 0}
          onClick={() => onMaj(x => changerMinutes(x, Math.max(0, minutesDe(x) - PAS_MINUTES)))} style={btnPasStyle(tempsActif && min > 0)}>
          <Icon as={Minus} size={22} strokeWidth={2.6}/>
        </button>
        <div style={{ minWidth: 86, textAlign: "center", fontSize: 24, fontWeight: 800, color: T.text }}>
          {min > 0 ? fmtMinutes(min) : "0 h"}
        </div>
        <button aria-label="Ajouter 15 minutes" disabled={!tempsActif}
          onClick={() => onMaj(x => changerMinutes(x, minutesDe(x) + PAS_MINUTES))} style={btnPasStyle(tempsActif)}>
          <Icon as={Plus} size={22} strokeWidth={2.6}/>
        </button>
      </div>
      {/* Reste de moins de 15 min (trajets saisis à la minute) : un tap le pose ici. */}
      {tempsActif && ajustementPossible(resteMin) && min + resteMin >= 0 && (
        <button onClick={() => onMaj(x => poserReste(x, resteMin))} style={{
          marginTop: 8, width: "100%", minHeight: 44, borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          border: `1.5px dashed ${T.warning}`, background: T.warningBg, color: SOMBRE, fontSize: 14.5, fontWeight: 700,
        }}>
          {resteMin > 0 ? `Mettre les ${fmtMinutes(resteMin)} restantes ici` : `Retirer les ${fmtMinutes(-resteMin)} en trop ici`}
        </button>
      )}

      {/* Statut : grille 2 × 2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {STATUTS_GRILLE.map(s => {
          const sel = choix === s.id;
          return (
            <button key={s.id} aria-pressed={sel}
              onClick={() => onMaj(x => appliquerChoix(x, s.id, { avancementActuel }))} style={{
                minHeight: 52, borderRadius: 14, cursor: "pointer", fontFamily: "inherit", fontSize: 16, fontWeight: 800,
                border: `2px solid ${sel ? SOMBRE : T.border}`, background: sel ? (s.id === "termine" ? "#166534" : SOMBRE) : T.surface,
                color: sel ? "#fff" : T.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}>
              <Icon as={s.icon} size={17} strokeWidth={2.4}/> {CHOIX[s.id]}
            </button>
          );
        })}
      </div>

      {/* Avancement */}
      {(choix === "en_cours" || choix === "bloque") && (
        <div style={{ marginTop: 12, padding: "12px", borderRadius: 14, background: T.bg }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 8 }}>
            Avancement de la tâche{avancementActuel != null ? <span style={{ fontWeight: 600, color: T.textSub }}> (avant : {Math.round(avancementActuel)} %)</span> : null}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {[25, 50, 75].map(p => {
              const sel = parseInt(t.avancement) === p && String(t.avancement).trim() !== "";
              return (
                <button key={p} onClick={() => onMaj(x => ({ ...x, avancement: String(p) }))} aria-pressed={sel} style={{
                  minWidth: 64, minHeight: 48, borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 16, fontWeight: 800,
                  border: `2px solid ${sel ? SOMBRE : T.border}`, background: sel ? SOMBRE : T.surface, color: sel ? "#fff" : T.text,
                }}>{p} %</button>
              );
            })}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: T.textSub }}>
              ou
              <input type="number" inputMode="numeric" min="0" max="100" value={t.avancement ?? ""}
                onChange={e => {
                  const v = e.target.value === "" ? "" : String(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)));
                  onMaj(x => ({ ...x, avancement: v }));
                }} style={{
                  width: 70, minHeight: 48, borderRadius: 12, border: `1.5px solid ${T.border}`, fontSize: 18, fontWeight: 800,
                  textAlign: "center", fontFamily: "inherit",
                }}/> %
            </label>
          </div>
        </div>
      )}
      {choix === "termine" && (
        <div style={{ marginTop: 8, fontSize: 13, color: T.textSub }}>Avancement réglé à 100 %.</div>
      )}
      {choix === "pas_commence" && (
        <div style={{ marginTop: 8, fontSize: 13, color: T.textSub }}>
          Avancement inchangé{avancementActuel != null ? ` : ${Math.round(avancementActuel)} %` : ""}.
        </div>
      )}

      {/* Motif : obligatoire pour Bloqué et Pas commencé */}
      {(choix === "bloque" || choix === "pas_commence") && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 8 }}>
            {choix === "bloque" ? "Qu'est-ce qui bloque ?" : "Pourquoi pas commencé ?"}
          </div>
          <Pastilles options={MOTIFS_STATUT} valeur={t.motif} T={T}
            onChoisir={(code) => onMaj(x => ({ ...x, motif: code }))}/>
          {choix === "bloque" && t.motif === "attente_materiel" && onOuvrirCommande && (
            <button onClick={onOuvrirCommande} style={{
              marginTop: 10, minHeight: 44, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
              border: `1.5px solid ${T.info}`, background: T.infoBg, color: T.info, fontSize: 14.5, fontWeight: 800,
              display: "inline-flex", alignItems: "center", gap: 7,
            }}>
              <Icon as={ShoppingCart} size={16}/> Faire la demande de matériel <Icon as={ChevronRight} size={16}/>
            </button>
          )}
        </div>
      )}

      {/* Heures vendues, avec aujourd'hui (même pastille que l'onglet Phases) */}
      {suivi && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: T.textSub }}>
            Avec aujourd'hui : <strong style={{ color: T.text }}>{fmtH(suivi.avant + suivi.aujourdhui)}</strong> / {fmtH(suivi.vendues)} vendues
          </span>
          <Pastille etat={suivi.etat}/>
        </div>
      )}
      {!suivi && t.tache_id && infosEtat === "indisponible" && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.textSub, fontStyle: "italic" }}>
          Heures vendues indisponibles pour l'instant (connexion) : pas de jauge, rien ne bloque l'envoi.
        </div>
      )}
      {requis && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: T.dangerBg, border: `1.5px solid ${T.dangerBd}` }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.danger, marginBottom: 8 }}>
            {fmtH(suivi.avant + suivi.aujourdhui)} sur {fmtH(suivi.vendues)} vendues : pourquoi ?
          </div>
          {t.motif_depassement_repris && dernier?.code === t.motif_depassement && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: T.text, marginBottom: 8 }}>
              <Icon as={History} size={14}/>
              Déjà indiqué{dernier.date ? ` le ${dateCourte(dernier.date)}` : ""} : <strong>{libelleMotifDepassement(dernier.code)}</strong>. Touche un autre motif pour le changer.
            </div>
          )}
          <Pastilles options={MOTIFS_DEPASSEMENT} valeur={t.motif_depassement} T={T}
            onChoisir={(code) => onMaj(x => ({ ...x, motif_depassement: code, motif_depassement_repris: false, motif_depassement_choisi: true }))}/>
        </div>
      )}

      {/* Précision : facultative, obligatoire si « Autre » */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>
          Précision {problemes.includes("precision") ? <span style={{ color: T.danger }}>(obligatoire pour « Autre »)</span> : "(facultatif)"}
        </div>
        <textarea value={t.remarque || ""} onChange={e => onMaj(x => ({ ...x, remarque: e.target.value }))}
          placeholder={t.motif === CODE_MOTIF_AUTRE || t.motif_depassement === CODE_MOTIF_AUTRE ? "Explique en quelques mots…" : "Une précision, si besoin"}
          style={{
            width: "100%", boxSizing: "border-box", minHeight: 48, resize: "none", fontSize: 16, fontFamily: "inherit",
            border: `1.5px solid ${problemes.includes("precision") ? T.dangerBd : T.border}`, borderRadius: 12, padding: "10px 12px",
          }}/>
      </div>

      {photos}

      {/* Ce qui manque encore (une fois un statut choisi) */}
      {choix && problemes.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: T.danger }}>
          À compléter : {problemes.map(p => LIBELLES_PROBLEMES[p]).join(", ")}
        </div>
      )}

      {t.libre && onSupprimer && (
        <button onClick={onSupprimer} style={{
          marginTop: 10, minHeight: 44, padding: "0 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          border: `1.5px solid ${T.dangerBd}`, background: T.dangerBg, color: T.danger, fontSize: 14, fontWeight: 700,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}><Icon as={Trash2} size={14}/> Retirer cette tâche</button>
      )}
    </div>
  );
}
