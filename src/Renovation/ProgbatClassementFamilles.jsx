import React, { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { FolderTree, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";

export default function ProgbatClassementFamilles({ T, acc }) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [erreur, setErreur] = useState("");
  const [resultat, setResultat] = useState(null);
  const [confirmer, setConfirmer] = useState(false);

  const groupes = useMemo(() => {
    const map = new Map();
    for (const a of plan?.plan?.actions || []) {
      if (!map.has(a.familleLabel)) map.set(a.familleLabel, []);
      map.get(a.familleLabel).push(a);
    }
    return [...map.entries()];
  }, [plan]);

  async function preparer() {
    setLoading(true); setErreur(""); setResultat(null); setConfirmer(false);
    try {
      const { data, error } = await supabase.functions.invoke("progbat-library-categories", { body: { action: "prepare" } });
      if (error && !data) throw error;
      if (!data?.ok) throw new Error(data?.error || "Préparation du classement impossible.");
      setPlan(data);
    } catch (e) { setErreur(e?.message || "Erreur inattendue."); }
    setLoading(false);
  }

  async function executer() {
    if (!plan?.planHash) return;
    setLoading(true); setErreur("");
    try {
      const { data, error } = await supabase.functions.invoke("progbat-library-categories", {
        body: { action: "sync", expectedPlanHash: plan.planHash, confirmed: true },
      });
      if (error && !data) throw error;
      if (!data) throw new Error("Réponse vide du classement.");
      setResultat(data); setPlan(null); setConfirmer(false);
      if (!data.ok) setErreur(data.error || data.resultats_familles?.find((x) => x.error)?.error || "Classement interrompu.");
    } catch (e) { setErreur(e?.message || "Connexion interrompue : vérifier ProGBat avant de recommencer."); }
    setLoading(false);
  }

  const c = plan?.plan?.compteurs;
  return (
    <div style={{ marginTop: 14, padding: 12, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.card }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>
            <Icon as={FolderTree} size={14} color={acc.accent}/>Classer les ouvrages dans les familles métier
          </div>
          <div style={{ marginTop: 3, color: T.textSub, fontSize: FONT.xs.size + 1, lineHeight: 1.5 }}>
            Utilise le préfixe du code et les lots configurés dans Profero. La simulation crée au besoin les familles puis remplace uniquement le classement des ouvrages déjà liés.
          </div>
        </div>
        <button onClick={preparer} disabled={loading} style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: RADIUS.md,
          border: `1px solid ${acc.accent}`, background: "transparent", color: acc.accent,
          fontFamily: "inherit", fontWeight: 800, cursor: loading ? "wait" : "pointer", opacity: loading ? .55 : 1,
        }}><Icon as={RefreshCw} size={12}/>{loading ? "Préparation…" : "Préparer le classement"}</button>
      </div>

      {erreur && <div style={{ marginTop: 9, color: "#e15a5a", fontWeight: 700, fontSize: FONT.xs.size + 1 }}>⚠ {erreur}</div>}
      {resultat && <div style={{ marginTop: 9, padding: "8px 10px", borderRadius: RADIUS.md,
        color: resultat.ok ? "#22c55e" : "#f59e0b", background: resultat.ok ? "rgba(34,197,94,.08)" : "rgba(245,158,11,.08)",
        border: `1px solid ${resultat.ok ? "rgba(34,197,94,.28)" : "rgba(245,158,11,.28)"}`, fontWeight: 700 }}>
        {resultat.ok ? "Classement terminé" : "Classement interrompu"} : {resultat.compteurs?.categorized || 0} ouvrage(s) classé(s), {resultat.familles_creees || 0} famille(s) créée(s), {resultat.familles_activees || 0} famille(s) activée(s) pour les ouvrages.
        {!resultat.ok && resultat.resultats_familles?.find((x) => x.error)?.error && <div>{resultat.resultats_familles.find((x) => x.error).label} : {resultat.resultats_familles.find((x) => x.error).error}</div>}
        {resultat.verification_manuelle && <div>Une réponse est incertaine : vérifier ProGBat avant toute nouvelle tentative.</div>}
      </div>}

      {plan?.plan && <div style={{ marginTop: 10, padding: 11, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: T.text, fontWeight: 800 }}>Simulation contrôlée par le serveur</div>
            <div style={{ color: T.textSub, fontSize: FONT.xs.size + 1 }}>
              <strong>{c?.a_classer || 0}</strong> ouvrage(s) à classer · <strong>{c?.familles_a_activer || 0}</strong> famille(s) existante(s) à activer · <strong>{c?.familles_a_creer || 0}</strong> à créer · <strong>{c?.deja_classes || 0}</strong> déjà classé(s) · <strong>{c?.exclus || 0}</strong> exclu(s)
            </div>
          </div>
          <button onClick={() => setConfirmer(true)} disabled={!c?.a_classer || loading} style={{
            padding: "8px 14px", borderRadius: RADIUS.md, border: "none", fontFamily: "inherit", fontWeight: 800,
            background: c?.a_classer ? acc.accent : T.border, color: c?.a_classer ? acc.onAccent : T.textMuted,
            cursor: c?.a_classer ? "pointer" : "not-allowed",
          }}>Confirmer le classement</button>
        </div>
        {(plan.plan.famillesACreer || []).length > 0 && <div style={{ marginTop: 8, color: T.textSub }}>
          Familles à créer : {plan.plan.famillesACreer.map((f) => f.label).join(" · ")}
        </div>}
        {(plan.plan.famillesAActiver || []).length > 0 && <div style={{ marginTop: 8, color: T.textSub }}>
          Familles existantes à activer pour les ouvrages : {plan.plan.famillesAActiver.map((f) => f.label).join(" · ")}
        </div>}
        {groupes.length > 0 && <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
          {groupes.map(([label, actions]) => <div key={label} style={{ padding: "6px 8px", borderRadius: RADIUS.md, background: T.card, color: T.text }}>
            <strong>{label}</strong> — {actions.length} ouvrage(s) : {actions.flatMap((a) => a.codes).join(", ")}
          </div>)}
        </div>}
        {(plan.plan.exclus || []).length > 0 && <div style={{ marginTop: 9, color: "#f59e0b", fontSize: FONT.xs.size + 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 800 }}><Icon as={AlertTriangle} size={12}/>Laissés dans « Ouvrages V2 »</div>
          <ul style={{ margin: "3px 0 0", paddingLeft: 17 }}>
            {plan.plan.exclus.map((x, i) => <li key={`${x.ouvrageId}-${i}`}><strong>{x.code || "Sans code"}</strong> — {x.raison}</li>)}
          </ul>
        </div>}
        <div style={{ marginTop: 9, color: T.textMuted, fontSize: FONT.xs.size }}>
          Écriture prévue par ouvrage : <code>{`PATCH { families: [id] }`}</code>. Aucun prix, libellé, code ou composant n’est transmis.
        </div>
      </div>}

      {confirmer && plan?.plan && <div style={{ position: "fixed", inset: 0, zIndex: 10020, background: "rgba(0,0,0,.62)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={() => !loading && setConfirmer(false)}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(600px,96vw)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center", color: T.text, fontSize: FONT.lg.size, fontWeight: 800 }}><Icon as={ShieldCheck} size={20} color={acc.accent}/>Confirmer le classement ProGBat</div>
          <div style={{ marginTop: 10, color: T.textSub, lineHeight: 1.6 }}>
            Profero va activer <strong>{c.familles_a_activer || 0} famille(s) existante(s)</strong>, créer <strong>{c.familles_a_creer} famille(s)</strong> si nécessaire et déplacer <strong>{c.a_classer} ouvrage(s)</strong> hors d’« Ouvrages V2 » vers leur famille métier.
          </div>
          <div style={{ marginTop: 10, padding: 10, borderRadius: RADIUS.md, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.25)", color: T.text }}>
            Seule l’affectation de famille change. Aucun ouvrage n’est créé ou supprimé et aucun prix n’est modifié.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <button onClick={() => setConfirmer(false)} disabled={loading} style={{ padding: "8px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit" }}>Annuler</button>
            <button onClick={executer} disabled={loading} style={{ padding: "8px 14px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: acc.onAccent, fontFamily: "inherit", fontWeight: 800, cursor: loading ? "wait" : "pointer" }}>{loading ? "Classement…" : "Classer les ouvrages"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
