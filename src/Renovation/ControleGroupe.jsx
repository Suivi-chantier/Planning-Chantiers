// ─────────────────────────────────────────────────────────────────────────────
// CONTRÔLE DE FIN DE GROUPE (Point 2 b, Prompt 3) — écran mobile d'abord.
//
// Principe NON NÉGOCIABLE : audit PAR EXCEPTION. Tout est conforme par
// défaut ; l'utilisateur ne touche QUE ce qui pose problème (« Réserve » ou
// « NOK », un geste), avec photo + note courte en option. Sur 40 tâches dont
// 38 sont bonnes : 2 gestes, pas 40.
//
// - Le périmètre est UN groupe d'exécution : les tâches sont lues directement
//   dans le phasage (passées en props depuis la vue chrono), jamais copiées.
// - Overlay plein écran (position fixed, zIndex 1100 — au-dessus de la
//   bottom-nav 200 et des modales PhasageV2 ≤ 1000), même pattern que le
//   « Mode parcours » des visites. Corps maxWidth 620 centré → desktop OK.
// - Thème CLAIR terrain (lisibilité plein soleil), comme RapportMobile.
// - Persistance : tables controles_groupe + reserves
//   (sql/202607_controles_groupe.sql). Une réserve référence sa tâche par
//   tache_id. Un contrôle terminé reste consultable et MODIFIABLE : rouvrir
//   recharge le dernier contrôle du groupe et ses réserves non levées.
// - Brouillon localStorage (saveDraft) + useDirtyGuard : une saisie debout
//   sur chantier survit à un reload PWA et bloque l'auto-update.
// - Photos : PhotosPicker de RapportMobile (compression + upload bucket
//   public "photos"), chemin controles/<chantier>/<groupe>/tache-<id>.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { X, Check, AlertTriangle, ClipboardCheck, RotateCw, ArrowLeft } from "lucide-react";
import { PhotosPicker } from "./RapportMobile";
import { T as TT } from "./EspaceOuvrier"; // thème clair terrain (contrat du kit mobile)
import { loadDraft, saveDraft, clearDraft, useDirtyGuard } from "../hooks";

// Statuts d'exception — mêmes couleurs que le reste de l'appli
// (réserve = warning des visites, NOK = danger sémantique).
const STATUTS_EXCEPTION = {
  reserve: { label: "Réserve", couleur: "#f59e0b", icone: AlertTriangle },
  nok:     { label: "NOK",     couleur: "#e15a5a", icone: X },
};
const VERT = "#22c55e";

export default function ControleGroupe({
  chantierId, chantierNom = "", phasageId = null,
  groupe,                 // { id, nom, couleur } (meta.chrono_groupes)
  taches = [],            // [{ id, nom, ouvrage }] — lues du phasage par l'appelant
  auteur = "",
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [controle, setControle] = useState(null);   // dernier contrôle du groupe (édition) ou null
  const [exceptions, setExceptions] = useState({}); // { [tacheId]: { statut, commentaire, photos, reserveId? } }
  const [saving, setSaving] = useState(false);
  const [fini, setFini] = useState(false);
  const [erreur, setErreur] = useState("");

  const cleDraft = `controle-${chantierId}-${groupe?.id}`;
  const nbExceptions = Object.keys(exceptions).length;
  const nbReserves = Object.values(exceptions).filter(e => e.statut === "reserve").length;
  const nbNok = Object.values(exceptions).filter(e => e.statut === "nok").length;
  const nbConformes = Math.max(0, taches.length - nbExceptions);
  const couleurGroupe = groupe?.couleur || "#5b8af5";

  // Saisie en cours → bloque l'auto-reload PWA.
  useDirtyGuard(cleDraft, !loading && !fini);

  // ── Chargement : dernier contrôle du groupe + ses réserves non levées ──
  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const { data: ctrls, error } = await supabase.from("controles_groupe")
          .select("*")
          .eq("chantier_id", chantierId).eq("groupe_id", groupe.id)
          .order("date_controle", { ascending: false }).limit(1);
        if (error) throw error;
        const dernier = ctrls?.[0] || null;
        let exc = {};
        if (dernier) {
          const { data: res, error: errRes } = await supabase.from("reserves")
            .select("*").eq("controle_id", dernier.id);
          if (errRes) throw errRes;
          (res || []).forEach(r => {
            if (r.levee_le) return; // les réserves levées restent dans l'historique, pas dans l'édition
            exc[r.tache_id] = {
              statut: r.statut, commentaire: r.commentaire || "",
              photos: Array.isArray(r.photos) ? r.photos : [], reserveId: r.id,
            };
          });
        }
        // Brouillon local (saisie interrompue) prioritaire sur la base.
        const draft = loadDraft(cleDraft);
        if (draft && typeof draft === "object" && !Array.isArray(draft)) exc = draft;
        if (actif) { setControle(dernier); setExceptions(exc); setLoading(false); }
      } catch (e) {
        if (!actif) return;
        setErreur(/relation .* does not exist|42P01/i.test(e?.message || "")
          ? "Tables des contrôles absentes : lancez sql/202607_controles_groupe.sql dans Supabase."
          : `Chargement impossible : ${e?.message || e}`);
        setLoading(false);
      }
    })();
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Gestes ──
  const majException = (tacheId, patch) => {
    setExceptions(prev => {
      const next = { ...prev, [tacheId]: { commentaire: "", photos: [], ...prev[tacheId], ...patch } };
      saveDraft(cleDraft, next);
      return next;
    });
  };
  // Un geste : bascule Réserve/NOK ; retap sur le statut actif = retour conforme.
  const toggleStatut = (tacheId, statut) => {
    setExceptions(prev => {
      const cur = prev[tacheId];
      let next;
      if (cur?.statut === statut) {
        next = { ...prev };
        delete next[tacheId]; // retour à conforme (la note/photos du brouillon partent avec)
      } else {
        next = { ...prev, [tacheId]: { commentaire: "", photos: [], ...cur, statut } };
      }
      saveDraft(cleDraft, next);
      return next;
    });
  };

  // ── Enregistrement : contrôle + synchronisation de SES réserves ──
  const terminer = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const entete = {
        chantier_id: chantierId, phasage_id: phasageId || null,
        groupe_id: groupe.id, groupe_nom: groupe.nom || "",
        date_controle: nowIso, auteur,
        nb_taches: taches.length, nb_conformes: nbConformes,
        updated_at: nowIso,
      };
      let controleId = controle?.id || null;
      if (controleId) {
        const { error } = await supabase.from("controles_groupe").update(entete).eq("id", controleId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("controles_groupe").insert(entete).select().single();
        if (error) throw error;
        controleId = data.id;
      }
      // Réserves du contrôle, par tache_id : insert des nouvelles, update des
      // existantes, suppression de celles dé-signalées pendant CETTE édition
      // (correction de saisie). Les réserves LEVÉES ne sont jamais touchées.
      const { data: existantes, error: errEx } = await supabase.from("reserves")
        .select("id, tache_id, levee_le").eq("controle_id", controleId);
      if (errEx) throw errEx;
      const parTache = new Map((existantes || []).filter(r => !r.levee_le).map(r => [r.tache_id, r]));
      for (const [tacheId, e] of Object.entries(exceptions)) {
        const t = taches.find(x => x.id === tacheId);
        const ligne = {
          chantier_id: chantierId, phasage_id: phasageId || null,
          groupe_id: groupe.id, controle_id: controleId,
          tache_id: tacheId, tache_nom: t?.nom || "",
          statut: e.statut, commentaire: (e.commentaire || "").trim(),
          photos: Array.isArray(e.photos) ? e.photos : [],
          auteur, updated_at: nowIso,
        };
        const deja = parTache.get(tacheId);
        if (deja) {
          const { error } = await supabase.from("reserves").update(ligne).eq("id", deja.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("reserves").insert(ligne);
          if (error) throw error;
        }
      }
      for (const r of parTache.values()) {
        if (!exceptions[r.tache_id]) {
          const { error } = await supabase.from("reserves").delete().eq("id", r.id);
          if (error) throw error;
        }
      }
      clearDraft(cleDraft);
      setControle(c => c ? { ...c, id: controleId } : { id: controleId });
      setFini(true);
    } catch (e) {
      alert(`Enregistrement impossible : ${e?.message || e}\n\nSi les tables n'existent pas, lancez sql/202607_controles_groupe.sql dans Supabase.`);
    }
    setSaving(false);
  };

  const fermer = () => { onClose?.(); };

  // ── Styles (gros boutons terrain, conventions du repo) ──
  const chip = (couleur, texte) => (
    <span key={texte} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 999,
      background: `${couleur}1a`, border: `1px solid ${couleur}44`,
      color: couleur, fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap",
    }}>{texte}</span>
  );

  const shell = (children) => (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100, background: TT.bg,
      display: "flex", flexDirection: "column",
      fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif", color: TT.text,
    }}>{children}</div>
  );

  // ── Écran de fin ──
  if (fini) return shell(
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%", background: VERT,
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
        boxShadow: `0 8px 24px ${VERT}55`,
      }}><Icon as={Check} size={34} color="#fff" strokeWidth={3}/></div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Contrôle enregistré</div>
      <div style={{ fontSize: 15, color: TT.textSub, marginBottom: 18 }}>{groupe?.nom} · {new Date().toLocaleDateString("fr-FR")}{auteur ? ` · ${auteur}` : ""}</div>
      <div style={{ display: "flex", gap: 22, marginBottom: 26 }}>
        {[[nbConformes, "conformes", VERT], [nbReserves, "réserves", STATUTS_EXCEPTION.reserve.couleur], [nbNok, "NOK", STATUTS_EXCEPTION.nok.couleur]].map(([v, l, c]) => (
          <div key={l} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: TT.textMuted, textTransform: "uppercase", letterSpacing: .5 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => setFini(false)} style={{
          padding: "13px 18px", borderRadius: RADIUS.lg, border: `1.5px solid ${TT.border}`,
          background: TT.surface, color: TT.textSub, fontSize: 15, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7,
        }}><Icon as={ArrowLeft} size={15}/> Revenir au contrôle</button>
        <button onClick={fermer} style={{
          padding: "13px 26px", borderRadius: RADIUS.lg, border: "none",
          background: VERT, color: "#fff", fontSize: 15, fontWeight: 800,
          cursor: "pointer", fontFamily: "inherit", boxShadow: `0 4px 16px ${VERT}55`,
        }}>Fermer</button>
      </div>
    </div>
  );

  return shell(
    <>
      {/* ── En-tête (sticky, safe-area) ── */}
      <div style={{
        flexShrink: 0, padding: "calc(10px + env(safe-area-inset-top)) 14px 10px",
        background: TT.surface, borderBottom: `1px solid ${TT.border}`,
        boxShadow: "0 2px 10px rgba(16,24,40,.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 10, height: 34, borderRadius: 5, background: couleurGroupe, flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.15, display: "flex", alignItems: "center", gap: 7 }}>
              <Icon as={ClipboardCheck} size={17} color={couleurGroupe}/>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Contrôle — {groupe?.nom || "Groupe"}</span>
            </div>
            <div style={{ fontSize: 12.5, color: TT.textMuted, fontWeight: 600 }}>
              {chantierNom || chantierId} · {taches.length} tâche{taches.length > 1 ? "s" : ""}
              {controle ? ` · dernier contrôle le ${new Date(controle.date_controle).toLocaleDateString("fr-FR")}` : ""}
            </div>
          </div>
          <button onClick={fermer} title="Fermer" style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            border: `1.5px solid ${TT.border}`, background: TT.surface, color: TT.textSub,
            cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}><Icon as={X} size={17}/></button>
        </div>
        {/* Compteur clair : « 38 conformes · 2 réserves » */}
        <div style={{ display: "flex", gap: 6, marginTop: 9, overflowX: "auto" }}>
          {chip(VERT, `${nbConformes} conforme${nbConformes > 1 ? "s" : ""}`)}
          {chip(STATUTS_EXCEPTION.reserve.couleur, `${nbReserves} réserve${nbReserves > 1 ? "s" : ""}`)}
          {chip(STATUTS_EXCEPTION.nok.couleur, `${nbNok} NOK`)}
        </div>
      </div>

      {/* ── Corps ── */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "14px 14px 20px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: TT.textMuted, padding: "40px 0", fontSize: 15 }}>Chargement…</div>
          ) : erreur ? (
            <div style={{
              background: "#e15a5a14", border: "1.5px solid #e15a5a55", borderRadius: 12,
              padding: 14, color: "#b34040", fontSize: 14.5, fontWeight: 600,
            }}>{erreur}</div>
          ) : taches.length === 0 ? (
            <div style={{ textAlign: "center", color: TT.textMuted, padding: "40px 0", fontSize: 15, fontStyle: "italic" }}>
              Aucune tâche rattachée à ce groupe.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: TT.textMuted, fontWeight: 600, margin: "2px 2px 12px", lineHeight: 1.35 }}>
                Tout est réputé <strong style={{ color: VERT }}>conforme</strong> par défaut — signalez uniquement ce qui pose problème.
              </div>
              {taches.map(t => {
                const exc = exceptions[t.id] || null;
                const st = exc ? STATUTS_EXCEPTION[exc.statut] : null;
                return (
                  <div key={t.id} style={{
                    background: TT.surface, borderRadius: 16, padding: "12px 14px", marginBottom: 10,
                    border: `1.5px solid ${st ? `${st.couleur}66` : TT.border}`,
                    borderLeft: `4px solid ${st ? st.couleur : VERT}`,
                    boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 6px 18px rgba(16,24,40,.06)",
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 9 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>{t.nom || "(sans nom)"}</div>
                        {t.ouvrage && <div style={{ fontSize: 12, color: TT.textMuted, fontWeight: 600 }}>{t.ouvrage}</div>}
                      </div>
                      <span style={{
                        flexShrink: 0, fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase",
                        color: st ? st.couleur : VERT, padding: "2px 8px", borderRadius: 999,
                        background: `${st ? st.couleur : VERT}14`,
                      }}>{st ? st.label : "Conforme"}</span>
                    </div>
                    {/* Deux gestes : Réserve / NOK (retap = retour conforme) */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {Object.entries(STATUTS_EXCEPTION).map(([id, def]) => {
                        const actif = exc?.statut === id;
                        return (
                          <button key={id} onClick={() => toggleStatut(t.id, id)} style={{
                            padding: "13px 6px", borderRadius: RADIUS.lg,
                            border: `2px solid ${actif ? def.couleur : TT.border}`,
                            background: actif ? `${def.couleur}1a` : TT.surface,
                            color: actif ? def.couleur : TT.textMuted,
                            fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                          }}>
                            <Icon as={def.icone} size={17} strokeWidth={2.4}/>{def.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* Révélé au signalement : note courte + photo en un tap */}
                    {exc && (
                      <div style={{ marginTop: 10 }}>
                        <textarea rows={2} value={exc.commentaire || ""}
                          onChange={e => majException(t.id, { commentaire: e.target.value })}
                          placeholder="Note courte (ce qui pose problème)…"
                          style={{
                            width: "100%", boxSizing: "border-box", padding: "10px 12px",
                            borderRadius: RADIUS.lg, border: `1.5px solid ${TT.border}`,
                            background: TT.bg, color: TT.text, fontFamily: "inherit",
                            fontSize: 16, /* anti-zoom iOS */ resize: "vertical", outline: "none",
                          }}/>
                        <div style={{ marginTop: 8 }}>
                          <PhotosPicker photos={exc.photos || []}
                            onChange={arr => majException(t.id, { photos: arr })}
                            pathPrefix={`controles/${chantierId}/${groupe.id}/tache-${t.id}`}
                            color={st?.couleur || couleurGroupe} label="Photo du problème"/>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── Barre basse : Terminer (safe-area) ── */}
      {!loading && !erreur && taches.length > 0 && (
        <div style={{
          flexShrink: 0, padding: "10px 14px calc(12px + env(safe-area-inset-bottom))",
          background: TT.surface, borderTop: `1px solid ${TT.border}`,
        }}>
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            <button onClick={terminer} disabled={saving} style={{
              width: "100%", padding: "16px", borderRadius: RADIUS.xl + 2, border: "none",
              background: saving ? TT.textMuted : VERT, color: "#fff",
              fontSize: FONT.lg.size, fontWeight: 800, cursor: saving ? "default" : "pointer",
              fontFamily: "inherit", boxShadow: saving ? "none" : `0 4px 20px ${VERT}4d`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {saving
                ? <><Icon as={RotateCw} size={17} style={{ animation: "spin 1s linear infinite" }}/> Enregistrement…</>
                : <><Icon as={ClipboardCheck} size={18}/> {controle ? "Enregistrer les modifications" : "Terminer le contrôle"}</>}
            </button>
            <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
          </div>
        </div>
      )}
    </>
  );
}
