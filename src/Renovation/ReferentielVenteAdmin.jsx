// src/Renovation/ReferentielVenteAdmin.jsx — Réglages → Taux horaires.
// Écran GÉNÉRIQUE d'administration d'un référentiel de vente (taux horaires
// de main-d'œuvre, coefficients de vente) : même tableau, mêmes actions, mêmes
// règles (module pur referentielVente.mjs, garanties par la base).
//   • un seul élément actif par défaut, jamais désactivable ni supprimable ;
//   • au moins un actif ; un élément désactivé n'est plus proposé aux ouvrages
//     mais ceux qui l'utilisent le conservent et restent calculables ;
//   • jamais de suppression physique ; modifier une valeur affiche un
//     avertissement avec le nombre RÉEL d'ouvrages concernés ;
//   • écriture réservée aux administrateurs (RLS is_admin()) ; toute erreur
//     Supabase est affichée, jamais masquée.
// Instances : TauxHorairesVenteAdmin.jsx et CoefficientsVenteAdmin.jsx.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Plus, Check, X, Pencil, Star, Power, AlertTriangle, RefreshCw } from "lucide-react";

/**
 * @param referentiel  instance de creerReferentielVente (règles pures)
 * @param table        table Supabase ("taux_horaires_vente" | "coefficients_vente")
 * @param colonneOuvrage colonne de bibliotheque_ratios référençant l'élément
 * @param rpcDefaut    RPC de bascule du défaut
 * @param titre / description (JSX) / icone / colonneValeur (en-tête) / suffixe (unité de saisie)
 * @param inputValeur  { step, min, placeholder }
 * @param formaterValeur (n) => texte affiché dans le tableau
 */
export default function ReferentielVenteAdmin({
  T, acc, profil, referentiel, table, colonneOuvrage, rpcDefaut, titre, description, icone,
  colonneValeur, suffixe, inputValeur = { step: "0.5", min: "0.01", placeholder: "" }, formaterValeur,
  libelleAjout = "Ajouter", placeholderLibelle = "Libellé",
}) {
  const champ = referentiel.cfg.champValeur;
  const [items, setItems] = useState([]);
  const [usages, setUsages] = useState({});          // { id: nb d'ouvrages }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [erreur, setErreur] = useState(null);        // erreur Supabase (persistante jusqu'à la prochaine action)
  const [ok, setOk] = useState(null);
  const [ajout, setAjout] = useState(null);          // { libelle, [champ] }
  const [edition, setEdition] = useState(null);      // { id, libelle, [champ] }
  const [confirmation, setConfirmation] = useState(null); // { titre, message, action }
  const [schemaManquant, setSchemaManquant] = useState(false);
  const peutModifier = profil?.role === "admin";

  useEffect(() => {
    charger();
    const ch = supabase.channel(`${table}-admin-rt`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => charger({ silencieux: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "bibliotheque_ratios" }, () => chargerUsages())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [table]);

  async function chargerUsages() {
    const { data, error } = await supabase.from("bibliotheque_ratios").select(colonneOuvrage);
    if (error) return;
    const u = {};
    (data || []).forEach(o => { const id = o[colonneOuvrage]; if (id) u[id] = (u[id] || 0) + 1; });
    setUsages(u);
  }

  // silencieux : rafraîchissement de fond (temps réel) — pas d'écran de
  // chargement, qui démonterait la ligne en cours d'édition.
  async function charger({ silencieux = false } = {}) {
    if (!silencieux) setLoading(true);
    const { data, error } = await supabase.from(table).select("*").order("libelle");
    if (error) {
      if (new RegExp(table).test(error.message || "") && /does not exist|schema cache/i.test(error.message || "")) setSchemaManquant(true);
      else setErreur(referentiel.messageErreur(error, { action: "Le chargement" }));
      setItems([]);
    } else {
      setItems([...(data || [])].sort(referentiel.comparer));
    }
    await chargerUsages();
    if (!silencieux) setLoading(false);
  }

  const diag = useMemo(() => referentiel.diagnostiquer(items), [items, referentiel]);
  const flashOk = (m) => { setOk(m); setErreur(null); setTimeout(() => setOk(null), 3500); };
  const echec = (error, action) => { setErreur(referentiel.messageErreur(error, { action })); setOk(null); };

  // ── Actions Supabase : chaque `error` est contrôlé, rien n'est supposé réussi ──
  async function ajouter() {
    const v = referentiel.validerSaisie(ajout, items);
    if (!v.valide) { setErreur(v.erreurs.join(" · ")); return; }
    setBusy("ajout");
    const { data, error } = await supabase.from(table)
      .insert({ libelle: v.valeur.libelle, [champ]: v.valeur[champ], actif: true, est_defaut: false })
      .select().single();
    setBusy(null);
    if (error || !data) { echec(error || { message: "réponse vide" }, "L'ajout"); return; }
    setItems(prev => [...prev.filter(t => t.id !== data.id), data].sort(referentiel.comparer));
    setAjout(null);
    flashOk(`« ${data.libelle} » ajouté (${formaterValeur(data[champ])})`);
  }

  async function enregistrerEdition() {
    const ancien = items.find(t => t.id === edition?.id);
    if (!ancien) return;
    const v = referentiel.validerSaisie(edition, items, edition.id);
    if (!v.valide) { setErreur(v.erreurs.join(" · ")); return; }
    const appliquer = async () => {
      setBusy(edition.id);
      const { data, error } = await supabase.from(table)
        .update({ libelle: v.valeur.libelle, [champ]: v.valeur[champ] })
        .eq("id", edition.id).select().single();
      setBusy(null);
      if (error || !data) { echec(error || { message: "aucune ligne modifiée (droits insuffisants ?)" }, "La modification"); return; }
      setItems(prev => prev.map(t => t.id === data.id ? data : t).sort(referentiel.comparer));
      setEdition(null);
      flashOk(`« ${data.libelle} » enregistré (${formaterValeur(data[champ])})`);
    };
    // Nombre RÉEL d'ouvrages concernés (recompté à l'instant pour ne pas afficher une valeur périmée)
    const { count } = await supabase.from("bibliotheque_ratios").select("id", { count: "exact", head: true }).eq(colonneOuvrage, ancien.id);
    const nb = typeof count === "number" ? count : (usages[ancien.id] ?? null);
    const avert = referentiel.avertissementModification(ancien, v.valeur[champ], { nbOuvrages: nb });
    if (avert) setConfirmation({ titre: "Modifier la valeur", message: avert, action: appliquer });
    else await appliquer();
  }

  async function basculerActif(t) {
    const controle = t.actif === false ? referentiel.peutReactiver(t) : referentiel.peutDesactiver(t, items);
    if (!controle.ok) { setErreur(controle.raison); return; }
    const appliquer = async () => {
      setBusy(t.id);
      const { data, error } = await supabase.from(table).update({ actif: t.actif === false }).eq("id", t.id).select().single();
      setBusy(null);
      if (error || !data) { echec(error || { message: "aucune ligne modifiée (droits insuffisants ?)" }, t.actif === false ? "La réactivation" : "La désactivation"); return; }
      setItems(prev => prev.map(x => x.id === data.id ? data : x).sort(referentiel.comparer));
      flashOk(data.actif ? `« ${data.libelle} » réactivé` : `« ${data.libelle} » désactivé — les ${usages[t.id] || 0} ouvrage(s) qui l'utilisent le conservent`);
    };
    if (t.actif !== false) {
      setConfirmation({
        titre: "Désactiver",
        message: `« ${t.libelle} » ne sera plus proposé pour les nouveaux ouvrages. ${usages[t.id] ? `Les ${usages[t.id]} ouvrage(s) qui l'utilisent le conservent (affiché « désactivé » dans leur fiche) et restent calculables.` : "Aucun ouvrage ne l'utilise actuellement."} Les devis figés ne sont pas modifiés.`,
        action: appliquer,
      });
    } else await appliquer();
  }

  async function definirDefaut(t) {
    const controle = referentiel.peutDefinirDefaut(t);
    if (!controle.ok) { setErreur(controle.raison); return; }
    setBusy(t.id);
    const { data, error } = await supabase.rpc(rpcDefaut, { p_id: t.id });
    setBusy(null);
    if (error) { echec(error, "Le changement de valeur par défaut"); return; }
    if (!data?.est_defaut) { echec({ message: "la base n'a pas confirmé la nouvelle valeur par défaut" }, "Le changement de valeur par défaut"); return; }
    await charger();
    flashOk(`« ${t.libelle} » est maintenant la valeur par défaut des nouveaux ouvrages`);
  }

  // ── Rendu ────────────────────────────────────────────────────────────────────
  const inputS = { padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 700, outline: "none" };
  const btnS = (variant = "ghost", disabled = false) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: RADIUS.md,
    border: variant === "primary" ? "none" : `1px solid ${T.border}`,
    background: variant === "primary" ? acc.accent : "transparent",
    color: variant === "primary" ? acc.onAccent : variant === "danger" ? "#e15a5a" : T.textSub,
    fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1,
  });
  const pill = (txt, color) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs.size, fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}44`, padding: "2px 8px", borderRadius: RADIUS.pill, whiteSpace: "nowrap" }}>{txt}</span>
  );
  const nbActifs = referentiel.actifs(items).length;
  const champInput = (val, onChange, onEnter) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input type="number" min={inputValeur.min} step={inputValeur.step} value={val} onChange={e => onChange(e.target.value)} placeholder={inputValeur.placeholder}
        onKeyDown={e => { if (e.key === "Enter") onEnter(); }}
        style={{ ...inputS, width: 96, textAlign: "center", color: T.accent }}/>
      {suffixe && <span style={{ fontSize: 12, color: T.textMuted }}>{suffixe}</span>}
    </span>
  );

  return (
    <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 16, color: T.text }}>
          <Icon as={icone} size={14} color={acc.accent}/> {titre}
        </div>
        {peutModifier && !ajout && (
          <button onClick={() => { setAjout({ libelle: "", [champ]: "" }); setEdition(null); setErreur(null); }} style={btnS("primary")}>
            <Icon as={Plus} size={12}/> {libelleAjout}
          </button>
        )}
      </div>
      <div style={{ color: T.textSub, fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
        {description}
        {!peutModifier && <span> Consultation seule : la modification est réservée aux administrateurs.</span>}
      </div>

      {schemaManquant && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 12px", marginBottom: 10, borderRadius: RADIUS.md, background: "rgba(245,166,35,.12)", border: "1px solid rgba(245,166,35,.4)", color: "#f5a623", fontSize: FONT.xs.size + 1, fontWeight: 600 }}>
          <Icon as={AlertTriangle} size={13}/> Base non à jour : appliquer la migration <code style={{ fontFamily: "monospace" }}>{referentiel.cfg.migration}</code>.
        </div>
      )}
      {!loading && !schemaManquant && !diag.ok && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", marginBottom: 10, borderRadius: RADIUS.md, background: "rgba(225,90,90,.10)", border: "1px solid rgba(225,90,90,.35)", color: "#e15a5a", fontSize: FONT.xs.size + 1, fontWeight: 600 }}>
          <Icon as={AlertTriangle} size={13} style={{ marginTop: 2, flexShrink: 0 }}/>
          <div>{diag.problemes.map((m, i) => <div key={i}>{m}</div>)}</div>
        </div>
      )}
      {erreur && (
        <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", marginBottom: 10, borderRadius: RADIUS.md, background: "rgba(225,90,90,.10)", border: "1px solid rgba(225,90,90,.4)", color: "#e15a5a", fontSize: FONT.xs.size + 1, fontWeight: 700 }}>
          <Icon as={AlertTriangle} size={13} style={{ marginTop: 2, flexShrink: 0 }}/>
          <div style={{ flex: 1 }}>{erreur}</div>
          <button onClick={() => setErreur(null)} title="Fermer" style={{ background: "transparent", border: "none", color: "#e15a5a", cursor: "pointer", padding: 0 }}><Icon as={X} size={13}/></button>
        </div>
      )}
      {ok && (
        <div style={{ padding: "8px 12px", marginBottom: 10, borderRadius: RADIUS.md, background: "rgba(34,197,94,.10)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e", fontSize: FONT.xs.size + 1, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={Check} size={12}/> {ok}
        </div>
      )}

      {ajout && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", marginBottom: 10, background: T.card, borderRadius: RADIUS.md, border: `1px solid ${acc.accent}66` }}>
          <input autoFocus value={ajout.libelle} onChange={e => setAjout({ ...ajout, libelle: e.target.value })} placeholder={placeholderLibelle} style={{ ...inputS, flex: 2, minWidth: 180 }}/>
          {champInput(ajout[champ], (v) => setAjout({ ...ajout, [champ]: v }), ajouter)}
          <button onClick={ajouter} disabled={busy === "ajout"} style={btnS("primary", busy === "ajout")}><Icon as={Check} size={12}/> {busy === "ajout" ? "Enregistrement…" : "Créer"}</button>
          <button onClick={() => setAjout(null)} style={btnS()}>Annuler</button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.sm.size }}>
          <thead>
            <tr>
              {["Libellé", colonneValeur, "Statut", "Par défaut", "Ouvrages", "Actions"].map((h, i) => (
                <th key={h} style={{ textAlign: i === 1 || i === 4 ? "right" : "left", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .6, padding: "6px 8px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 12, color: T.textMuted }}><Icon as={RefreshCw} size={12} style={{ animation: "spin 1s linear infinite" }}/> Chargement…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={6} style={{ padding: 12, color: T.textMuted, fontStyle: "italic" }}>Aucun élément.</td></tr>}
            {items.map(t => {
              const enEdition = edition?.id === t.id;
              const inactif = t.actif === false;
              const desact = referentiel.peutDesactiver(t, items);
              const defaut = referentiel.peutDefinirDefaut(t);
              const cell = { padding: "8px 8px", borderBottom: `1px solid ${T.sectionDivider || T.border}`, color: inactif ? T.textMuted : T.text, verticalAlign: "middle" };
              return (
                <tr key={t.id} style={{ opacity: inactif ? .75 : 1 }}>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    {enEdition
                      ? <input autoFocus value={edition.libelle} onChange={e => setEdition({ ...edition, libelle: e.target.value })} style={{ ...inputS, width: "100%", minWidth: 160 }}/>
                      : t.libelle}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>
                    {enEdition ? champInput(edition[champ], (v) => setEdition({ ...edition, [champ]: v }), enregistrerEdition) : formaterValeur(t[champ])}
                  </td>
                  <td style={cell}>{inactif ? pill("Désactivé", "#9aa5c0") : pill("Actif", "#22c55e")}</td>
                  <td style={cell}>{t.est_defaut ? pill("Par défaut", acc.accent) : <span style={{ color: T.textMuted }}>—</span>}</td>
                  <td style={{ ...cell, textAlign: "right", color: T.textSub }} title="Ouvrages de la bibliothèque utilisant cette valeur">{usages[t.id] || 0}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {!peutModifier ? <span style={{ color: T.textMuted, fontSize: FONT.xs.size }}>lecture seule</span> : enEdition ? (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <button onClick={enregistrerEdition} disabled={busy === t.id} style={btnS("primary", busy === t.id)}><Icon as={Check} size={12}/> {busy === t.id ? "…" : "Enregistrer"}</button>
                        <button onClick={() => setEdition(null)} style={btnS()}>Annuler</button>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => { setEdition({ id: t.id, libelle: t.libelle, [champ]: String(t[champ]) }); setAjout(null); setErreur(null); }} disabled={busy != null} style={btnS("ghost", busy != null)} title="Modifier le libellé ou la valeur"><Icon as={Pencil} size={12}/> Modifier</button>
                        <button onClick={() => definirDefaut(t)} disabled={!defaut.ok || busy != null} style={btnS("ghost", !defaut.ok || busy != null)} title={defaut.ok ? "Présélectionner pour les nouveaux ouvrages" : defaut.raison}><Icon as={Star} size={12}/> Par défaut</button>
                        {inactif
                          ? <button onClick={() => basculerActif(t)} disabled={busy != null} style={btnS("ghost", busy != null)} title="Proposer de nouveau aux ouvrages"><Icon as={Power} size={12}/> Réactiver</button>
                          : <button onClick={() => basculerActif(t)} disabled={!desact.ok || busy != null} style={btnS("danger", !desact.ok || busy != null)} title={desact.ok ? "Ne plus proposer aux nouveaux ouvrages (aucune suppression)" : desact.raison}><Icon as={Power} size={12}/> Désactiver</button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && items.length > 0 && (
        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 8 }}>
          {nbActifs} actif{nbActifs > 1 ? "s" : ""} · {diag.defaut ? `par défaut : ${diag.defaut.libelle} (${formaterValeur(diag.defaut[champ])})` : "aucune valeur par défaut"} · rien n'est jamais supprimé : une valeur inutile se désactive.
        </div>
      )}

      {confirmation && (
        <div onClick={() => setConfirmation(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, padding: 22, width: "100%", maxWidth: 480, border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: RADIUS.md, background: "rgba(245,166,35,.15)", color: "#f5a623", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon as={AlertTriangle} size={16}/></div>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>{confirmation.titre}</div>
            </div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 16, whiteSpace: "pre-line" }}>{confirmation.message}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmation(null)} style={btnS()}>Annuler</button>
              <button onClick={async () => { const a = confirmation.action; setConfirmation(null); await a(); }} style={btnS("primary")}><Icon as={Check} size={12}/> Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
