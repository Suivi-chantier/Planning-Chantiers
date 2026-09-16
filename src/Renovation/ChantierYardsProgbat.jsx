// ─────────────────────────────────────────────────────────────────────────────
// « CHANTIERS ProGBat ASSOCIÉS » — rattachement explicite d'un ou plusieurs
// chantiers ProGBat (« yards ») au chantier Profero affiché.
//
// POURQUOI CE BLOC : une facture ProGBat porte `yardId`, le chantier ProGBat.
// C'est le rattachement STABLE — là où `quoteId` change à chaque avenant, et où
// une facture sans devis (quoteId = 0) porte quand même un yardId. Ce que
// personne ne sait, c'est à quel chantier PROFERO ce chantier ProGBat
// correspond : ce lien est posé ici, à la main, une fois pour toutes.
//
// Rien n'est jamais rapproché automatiquement — ni par libellé, ni par nom, ni
// par ressemblance. Deux chantiers ProGBat d'un même immeuble portent des
// libellés très proches ; un rapprochement « intelligent » se tromperait en
// silence et rattacherait de l'argent au mauvais chantier.
//
// La liste des chantiers ProGBat vient UNIQUEMENT de l'Edge Function
// progbat-yards-list (lecture seule chez ProGBat). Les rattachements
// enregistrés viennent UNIQUEMENT de chantier_progbat_yards. Les deux sont
// indépendants : si ProGBat est injoignable, les rattachements déjà en base
// restent affichés — ce sont eux qui comptent.
//
// Un chantier Profero peut recevoir PLUSIEURS chantiers ProGBat ; un chantier
// ProGBat n'appartient qu'à UN chantier Profero (contrainte unique en base,
// rappelée ici avant même la tentative d'écriture).
//
// ChantierProjetsProgbat (rattachement par devis) n'est pas remplacé : il reste
// le repli pour les factures sans yardId.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import {
  Building2, Plus, X, Loader2, AlertTriangle, Link2, Check, Search, RotateCcw,
} from "lucide-react";
import {
  libelleYard, rattachementsDuChantier, yardsPrisAilleurs, yardsProposables, yardIntrouvable,
} from "./progbatYardsEcran";

// ── Cache mémoire de la liste ProGBat ───────────────────────────────────────
// Objectif unique : ne pas rappeler l'Edge Function à chaque ouverture de fiche
// ni deux fois en parallèle. Une promesse partagée + un TTL court, rien de
// plus. Jamais de localStorage : cette liste vient d'un système tiers, elle n'a
// aucune raison de survivre à l'onglet.
const TTL_MS = 5 * 60 * 1000;
let cacheYards = null; // { at, promise }

async function appelerYards() {
  const { data, error } = await supabase.functions.invoke("progbat-yards-list");
  if (error && !data) {
    let body = null;
    try { body = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps JSON */ }
    throw new Error(body?.error || error.message || "Lecture des chantiers ProGBat impossible.");
  }
  if (!data?.ok) throw new Error(data?.error || "Réponse inattendue de la liste des chantiers ProGBat.");
  return Array.isArray(data.yards) ? data.yards : [];
}

/** Liste des yards ProGBat. `force` ignore le cache (bouton « Réessayer »). */
export function listerYardsProgbat({ force = false } = {}) {
  const frais = cacheYards && !force && Date.now() - cacheYards.at < TTL_MS;
  if (!frais) {
    const entree = { at: Date.now(), promise: null };
    // Un échec n'est pas mis en cache : le clic suivant doit vraiment réessayer.
    entree.promise = appelerYards().catch((e) => {
      if (cacheYards === entree) cacheYards = null;
      throw e;
    });
    cacheYards = entree;
  }
  return cacheYards.promise;
}

export default function ChantierYardsProgbat({ chantierId, chantiers = [], T, peutModifier = true }) {
  const [yards, setYards] = useState([]);          // liste ProGBat (Edge Function)
  const [erreurYards, setErreurYards] = useState("");
  const [liens, setLiens] = useState([]);          // chantier_progbat_yards (TOUS les chantiers)
  const [erreurLiens, setErreurLiens] = useState("");
  const [charge, setCharge] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [choix, setChoix] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const border = T?.border || "rgba(255,255,255,0.07)";
  const text = T?.text || "#f0f0f0";
  const textSub = T?.textSub || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // Les liens de TOUS les chantiers sont chargés, pas seulement ceux d'ici :
  // c'est ce qui permet de dire « déjà rattaché au chantier X » avant de tenter
  // une écriture vouée à être refusée par la contrainte unique.
  const chargerLiens = useCallback(async () => {
    const { data, error } = await supabase
      .from("chantier_progbat_yards")
      .select("id, chantier_id, progbat_yard_id, progbat_yard_label, progbat_public_yard_number, created_at");
    if (error) {
      setErreurLiens("Rattachements indisponibles : la migration sql/202609_chantier_progbat_yards.sql n'a peut-être pas encore été lancée.");
      setLiens([]);
      return;
    }
    setErreurLiens("");
    setLiens(data || []);
  }, []);

  const chargerYards = useCallback(async (force = false) => {
    setErreurYards("");
    try {
      setYards(await listerYardsProgbat({ force }));
    } catch (e) {
      setYards([]);
      setErreurYards(e?.message || "Liste des chantiers ProGBat indisponible.");
    }
  }, []);

  // Les deux chargements sont indépendants et parallèles : l'un ne doit jamais
  // empêcher l'autre de s'afficher.
  const charger = useCallback(async (force = false) => {
    if (!chantierId) return;
    setCharge(false);
    await Promise.all([chargerYards(force), chargerLiens()]);
    setCharge(true);
  }, [chantierId, chargerYards, chargerLiens]);

  useEffect(() => { charger(false); }, [charger]);

  const nomChantier = (id) => chantiers.find(c => String(c.id) === String(id))?.nom || id;

  const parId = useMemo(() => {
    const m = new Map();
    yards.forEach(y => m.set(String(y.id), y));
    return m;
  }, [yards]);

  const rattaches = useMemo(() => rattachementsDuChantier(liens, chantierId), [liens, chantierId]);
  const prisAilleurs = useMemo(() => yardsPrisAilleurs(liens, chantierId), [liens, chantierId]);

  // ~110 chantiers ProGBat : une liste brute serait inutilisable. Le champ de
  // recherche filtre AVANT le select ; les chantiers déjà rattachés ici en
  // sortent, ceux pris ailleurs y restent mais désactivés (on comprend pourquoi
  // ils manquent, au lieu de les chercher en vain).
  const proposables = useMemo(
    () => yardsProposables({ yards, liens, chantierId, recherche }),
    [yards, liens, chantierId, recherche],
  );

  const rattacher = async () => {
    if (!choix || busy) return;
    const yard = parId.get(String(choix));
    if (!yard) { setMessage("Ce chantier ProGBat n'est plus dans la liste : rechargez la liste."); return; }
    if (prisAilleurs.has(String(choix))) {
      setMessage(`Ce chantier ProGBat est déjà rattaché au chantier « ${nomChantier(prisAilleurs.get(String(choix)))} ». Détachez-le d'abord.`);
      return;
    }
    setBusy(true); setMessage("");
    // cree_par n'est pas envoyé : la base applique default auth.uid().
    const { error } = await supabase.from("chantier_progbat_yards").insert({
      chantier_id: chantierId,
      progbat_yard_id: yard.id,
      progbat_yard_label: yard.label || null,
      progbat_public_yard_number: yard.publicYardNumber || null,
    });
    setBusy(false);
    if (error) {
      // 23505 = contrainte unique : le yard a été rattaché ailleurs entre le
      // chargement de l'écran et le clic.
      setMessage(error.code === "23505"
        ? "Ce chantier ProGBat vient d'être rattaché à un autre chantier Profero."
        : `Rattachement impossible : ${error.message}`);
      await chargerLiens();
      return;
    }
    setChoix(""); setRecherche("");
    setMessage(`« ${libelleYard(yard.label, yard.id)} » rattaché à ce chantier.`);
    await chargerLiens();
  };

  const detacher = async (lien) => {
    const nom = libelleYard(lien.progbat_yard_label, lien.progbat_yard_id);
    if (!window.confirm(`Détacher le chantier ProGBat « ${nom} » ?\n\nSes futures factures ne seront plus reconnues automatiquement sur ce chantier.`)) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.from("chantier_progbat_yards").delete().eq("id", lien.id);
    setBusy(false);
    if (error) { setMessage(`Détachement impossible : ${error.message}`); return; }
    setMessage(`« ${nom} » détaché de ce chantier.`);
    await chargerLiens();
  };

  const champStyle = {
    padding: "7px 10px", borderRadius: RADIUS.md,
    border: `1px solid ${border}`, background: T?.inputBg || "transparent", color: text,
    fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none",
  };
  const erreurBloc = {
    display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", marginBottom: 10,
    borderRadius: RADIUS.md, background: "rgba(245,158,11,0.10)",
    border: "1px solid rgba(245,158,11,0.35)",
    fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600,
  };

  return (
    <div style={{ flex: "1 1 100%", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4,
        fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2,
        textTransform: "uppercase", color: textMuted,
      }}>
        <Icon as={Building2} size={11}/> Chantiers ProGBat associés
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginBottom: 9, lineHeight: 1.5 }}>
        Les factures et avenants de ces chantiers seront automatiquement rattachés à ce chantier Profero.
      </div>

      {erreurLiens && (
        <div style={erreurBloc}>
          <Icon as={AlertTriangle} size={13} style={{ flexShrink: 0, marginTop: 1 }}/>{erreurLiens}
        </div>
      )}

      {erreurYards && (
        <div style={erreurBloc}>
          <Icon as={AlertTriangle} size={13} style={{ flexShrink: 0, marginTop: 1 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            Liste des chantiers ProGBat indisponible : {erreurYards}
            <div style={{ fontWeight: 500, opacity: .9, marginTop: 2 }}>
              Les rattachements déjà enregistrés ci-dessous restent valables.
            </div>
          </div>
          <button onClick={() => charger(true)} disabled={!charge} style={{
            display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
            padding: "3px 9px", borderRadius: RADIUS.md, border: "1px solid rgba(245,158,11,0.45)",
            background: "transparent", color: "#f59e0b", fontFamily: "inherit",
            fontSize: FONT.xs.size, fontWeight: 700, cursor: charge ? "pointer" : "default",
          }}>
            <Icon as={charge ? RotateCcw : Loader2} size={11}/> Réessayer
          </button>
        </div>
      )}

      {!charge ? (
        <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={Loader2} size={12}/> Chargement des chantiers ProGBat…
        </div>
      ) : (
        <>
          {/* Chantiers ProGBat rattachés */}
          {rattaches.length === 0 ? (
            <div style={{
              padding: "11px 13px", borderRadius: RADIUS.lg, border: `1px dashed ${border}`,
              fontSize: FONT.xs.size + 1, color: textMuted, lineHeight: 1.6,
            }}>
              Aucun chantier ProGBat rattaché. Tant que ce lien n'est pas posé, les factures ProGBat de ce
              chantier ne peuvent pas être reconnues automatiquement — elles devront être rattachées à la main.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {rattaches.map(l => {
                // Le yard existe-t-il encore chez ProGBat ? La question n'a de
                // sens que si la liste a pu être lue : sinon on ne sait pas, et
                // on ne prétend pas savoir.
                const connu = parId.get(String(l.progbat_yard_id));
                const introuvable = yardIntrouvable(l, yards, !erreurYards);
                const numero = connu?.publicYardNumber || l.progbat_public_yard_number || "";
                return (
                  <div key={l.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 9,
                    padding: "9px 11px", borderRadius: RADIUS.lg, border: `1px solid ${border}`,
                  }}>
                    <Icon as={Link2} size={13} color={introuvable ? "#f59e0b" : "#22c55e"}
                      style={{ flexShrink: 0, marginTop: 2 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: text }}>
                        {libelleYard(l.progbat_yard_label, l.progbat_yard_id)}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3, fontSize: FONT.xs.size + 1, color: textSub }}>
                        <span>ProGBat n°{l.progbat_yard_id}</span>
                        {numero && <span>n° public {numero}</span>}
                        {introuvable && (
                          <span style={{ color: textMuted, fontStyle: "italic" }}>
                            Non retrouvé actuellement dans ProGBat
                          </span>
                        )}
                      </div>
                    </div>
                    {peutModifier && (
                      <button onClick={() => detacher(l)} disabled={busy} title="Détacher ce chantier ProGBat"
                        style={{
                          background: "transparent", border: `1px solid ${border}`, borderRadius: RADIUS.md,
                          padding: "3px 8px", color: textMuted, cursor: busy ? "default" : "pointer",
                          fontFamily: "inherit", display: "inline-flex", alignItems: "center", flexShrink: 0,
                        }}><Icon as={X} size={11}/></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Rechercher puis rattacher un chantier ProGBat */}
          {peutModifier && !erreurYards && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <div style={{ position: "relative", flex: "0 1 220px", minWidth: 160 }}>
                <Icon as={Search} size={12} color={textMuted}
                  style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}/>
                <input value={recherche} placeholder="Rechercher un chantier ProGBat…"
                  onChange={e => { setRecherche(e.target.value); setChoix(""); setMessage(""); }}
                  style={{ ...champStyle, width: "100%", paddingLeft: 26, boxSizing: "border-box" }}/>
              </div>
              <select value={choix} onChange={e => { setChoix(e.target.value); setMessage(""); }}
                disabled={busy || proposables.length === 0}
                style={{ ...champStyle, flex: "1 1 260px", minWidth: 200 }}>
                <option value="">
                  {yards.length === 0
                    ? "Aucun chantier ProGBat lu"
                    : proposables.length === 0
                      ? (recherche ? "Aucun résultat pour cette recherche" : "Tous les chantiers ProGBat sont déjà rattachés")
                      : `Choisir un chantier ProGBat… (${proposables.length})`}
                </option>
                {proposables.map(y => (
                  <option key={y.id} value={y.id} disabled={!!y.pris}>
                    {libelleYard(y.label, y.id)} — ProGBat n°{y.id}
                    {y.publicYardNumber ? ` · n° public ${y.publicYardNumber}` : ""}
                    {y.pris ? ` — déjà rattaché à ${nomChantier(y.pris)}` : ""}
                  </option>
                ))}
              </select>
              <button onClick={rattacher} disabled={!choix || busy} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
                background: !choix || busy ? border : "#22c55e",
                color: !choix || busy ? textMuted : "#fff",
                fontSize: FONT.xs.size + 1, fontWeight: 800,
                cursor: !choix || busy ? "default" : "pointer", fontFamily: "inherit",
              }}>
                <Icon as={busy ? Loader2 : Plus} size={12}/>{busy ? "Enregistrement…" : "Rattacher"}
              </button>
            </div>
          )}

          {message && (
            <div style={{
              marginTop: 8, display: "flex", gap: 7, fontSize: FONT.xs.size + 1,
              color: message.includes("impossible") || message.includes("déjà") ? "#e15a5a" : textSub,
              fontWeight: 600,
            }}>
              <Icon as={message.includes("impossible") || message.includes("déjà") ? AlertTriangle : Check}
                size={12} style={{ flexShrink: 0, marginTop: 2 }}/>
              {message}
            </div>
          )}
        </>
      )}
    </div>
  );
}
