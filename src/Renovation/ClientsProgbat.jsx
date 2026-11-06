// src/Renovation/ClientsProgbat.jsx — Refonte Opérations, lot 4 (demande de Loris du 06/11).
// « Les clients existent déjà dans ProGBat : créer un client dans l'appli
// ferait des doublons. » Ici :
//   - ChoixClientProgbatModal : rechercher un client ProGBat EXISTANT (liste lue
//     en LECTURE par l'Edge Function progbat-operations) et le choisir ; la
//     fiche locale est créée pré-remplie (ou réutilisée si elle existe déjà) ;
//   - RessemblancesProgbat : avant « + Nouveau client », les clients ProGBat
//     qui ressemblent, avec l'avertissement « existe peut-être déjà ».
// Rien n'est jamais rattaché automatiquement : l'utilisateur choisit. Aucune
// écriture dans ProGBat.
import React, { useEffect, useMemo, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Search, X, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { appelerProgbatOperations } from "./ProgbatClientChantier.jsx";
import { chercherCorrespondances, normaliserTexte } from "./progbatAutomatisation.js";

// Liste gardée 5 minutes dans l'onglet (le serveur a son propre cache).
let memoire = null;
export async function chargerClientsProgbat({ forcer = false } = {}) {
  if (!forcer && memoire && Date.now() - memoire.t < 5 * 60 * 1000) return memoire.rep;
  const rep = await appelerProgbatOperations({ action: "lister_clients_progbat" });
  if (rep?.ok) memoire = { t: Date.now(), rep };
  return rep;
}

/** Choix d'un client ProGBat → fiche locale. onChoisi(client, { manquants, message, reutilise }). */
export async function importerClientProgbat(m) {
  return await appelerProgbatOperations({ action: "importer_client_progbat", thirdId: m.id, confirmed: true });
}

const carteTiers = (T, m, action) => (
  <div key={m.id} style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "6px 8px", display: "flex", gap: 8, alignItems: "center" }}>
    <div style={{ flex: 1, minWidth: 0, fontSize: FONT.xs.size + 1, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700, color: T.text }}>{m.nom || m.code} <span style={{ color: T.textMuted, fontWeight: 500 }}>· n° ProGBat {m.id} · {m.type_libelle}</span></div>
      <div style={{ color: T.textMuted }}>{[m.code, [m.adresse, m.code_postal, m.ville].filter(Boolean).join(" "), m.email, m.telephone].filter(Boolean).join(" · ")}</div>
      {m.raisons?.length > 0 && <div style={{ color: "#4db8ff" }}>{m.raisons.join(" · ")}</div>}
    </div>
    {action}
  </div>
);

export function ChoixClientProgbatModal({ T, onClose, onChoisi }) {
  const [rep, setRep] = useState(null);
  const [q, setQ] = useState("");
  const [occupe, setOccupe] = useState(null);
  const [erreur, setErreur] = useState(null);
  const charger = async (forcer = false) => { setRep(null); setRep(await chargerClientsProgbat({ forcer })); };
  useEffect(() => { charger(); }, []);
  const liste = useMemo(() => {
    const mots = normaliserTexte(q).split(" ").filter(Boolean);
    const tous = rep?.clients || [];
    if (!mots.length) return tous.slice(0, 60);
    return tous.filter((m) => {
      const h = normaliserTexte([m.nom, m.societe, m.code, m.email, m.adresse, m.code_postal, m.ville].join(" "));
      return mots.every((x) => h.includes(x));
    }).slice(0, 60);
  }, [rep, q]);
  const choisir = async (m) => {
    if (!window.confirm(`Utiliser le client ProGBat « ${m.nom || m.code} » (n° ${m.id}) ?\nSa fiche est reprise dans l'application (ou réutilisée si elle existe déjà). Rien n'est modifié dans ProGBat.`)) return;
    setOccupe(m.id); setErreur(null);
    const r = await importerClientProgbat(m);
    setOccupe(null);
    if (r?.ok) onChoisi?.(r.client, r); else setErreur(r?.error || "Impossible de reprendre ce client.");
  };
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, width: "min(720px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, fontWeight: 800, color: T.text, fontSize: FONT.md.size }}>Choisir un client ProGBat existant</div>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, width: 30, height: 30, cursor: "pointer", color: T.textSub }}><Icon as={X} size={14} /></button>
        </div>
        <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center" }}>
          <Icon as={Search} size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, e-mail, ville ou adresse…" style={{ flex: 1, padding: "7px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit" }} />
          <button onClick={() => charger(true)} title="Relire la liste dans ProGBat" style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "6px 8px", cursor: "pointer", color: T.textSub }}><Icon as={RefreshCw} size={12} /></button>
        </div>
        <div style={{ padding: "0 16px 14px", overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {!rep && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Lecture des clients ProGBat…</div>}
          {rep && !rep.ok && <div style={{ color: "#e15a5a", fontWeight: 700, fontSize: FONT.sm.size }}>{rep.error || "Liste des clients ProGBat illisible."}</div>}
          {rep?.ok && <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>{rep.clients.length} clients et prospects dans ProGBat{q ? ` · ${liste.length} affiché(s)` : liste.length < rep.clients.length ? ` · 60 premiers affichés, affiner la recherche` : ""}.</div>}
          {erreur && <div style={{ color: "#e15a5a", fontWeight: 700, fontSize: FONT.xs.size + 1 }}><Icon as={AlertTriangle} size={12} /> {erreur}</div>}
          {rep?.ok && liste.map((m) => carteTiers(T, m, (
            <button onClick={() => choisir(m)} disabled={occupe != null} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: RADIUS.md, border: "none", background: "#FFC300", color: "#000", fontWeight: 700, fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: occupe != null ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              <Icon as={occupe === m.id ? RefreshCw : Check} size={11} />Choisir
            </button>
          )))}
          {rep?.ok && q && liste.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucun client ProGBat ne correspond à « {q} ».</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Avant « + Nouveau client » : clients ProGBat qui ressemblent à la fiche en
 * cours de saisie (nom, e-mail, téléphone, adresse). `accuse` / `setAccuse` :
 * case « aucun ne correspond » exigée pour enregistrer quand il y en a.
 * onUtiliser(client, rep) : un client ProGBat a été choisi (fiche locale reprise).
 * onEtat({ ressemblances, lisible }) : pour bloquer l'enregistrement.
 */
export function RessemblancesProgbat({ T, fiche, accuse, setAccuse, onUtiliser, onEtat }) {
  const [rep, setRep] = useState(null);
  const [occupe, setOccupe] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { let actif = true; chargerClientsProgbat().then((r) => { if (actif) setRep(r); }); return () => { actif = false; }; }, []);
  const ressemblances = useMemo(() => (rep?.ok ? chercherCorrespondances(fiche, rep.clients) : []), [rep, fiche]);
  useEffect(() => { onEtat?.({ ressemblances: ressemblances.length, lisible: !!rep?.ok, charge: !!rep }); }, [ressemblances.length, rep]); // eslint-disable-line react-hooks/exhaustive-deps
  const utiliser = async (m) => {
    if (!window.confirm(`Utiliser le client ProGBat « ${m.nom || m.code} » (n° ${m.id}) au lieu de créer un nouveau client ?`)) return;
    setOccupe(m.id); setErreur(null);
    const r = await importerClientProgbat(m);
    setOccupe(null);
    if (r?.ok) onUtiliser?.(r.client, r); else setErreur(r?.error || "Impossible de reprendre ce client.");
  };
  if (!rep) return <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Recherche des clients ProGBat qui ressemblent…</div>;
  if (!rep.ok) return <div style={{ fontSize: FONT.xs.size + 1, color: "#f5a623", fontWeight: 600 }}>Clients ProGBat non vérifiés : {rep.error || "liste illisible"}. Vérifiez dans ProGBat que ce client n'existe pas déjà.</div>;
  if (!ressemblances.length) return <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Aucun client ProGBat ne ressemble à cette fiche pour l'instant ({rep.clients.length} clients lus).</div>;
  return (
    <div style={{ border: "1px solid #f5a62388", background: "#f5a62312", borderRadius: RADIUS.md, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 800, color: "#f5a623", fontSize: FONT.xs.size + 1 }}>
        <Icon as={AlertTriangle} size={12} /> Ce client existe peut-être déjà dans ProGBat ({ressemblances.length}) : le choisir évite un doublon.
      </div>
      {ressemblances.map((m) => carteTiers(T, m, (
        <button type="button" onClick={() => utiliser(m)} disabled={occupe != null} style={{ padding: "5px 10px", borderRadius: RADIUS.md, border: "none", background: "#FFC300", color: "#000", fontWeight: 700, fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", whiteSpace: "nowrap" }}>Utiliser ce client</button>
      )))}
      {erreur && <div style={{ color: "#e15a5a", fontWeight: 700, fontSize: FONT.xs.size + 1 }}>{erreur}</div>}
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: FONT.xs.size + 1, color: T.textSub, fontWeight: 600, cursor: "pointer" }}>
        <input type="checkbox" checked={!!accuse} onChange={(e) => setAccuse(e.target.checked)} />
        Aucun de ces clients ProGBat ne correspond : créer une nouvelle fiche
      </label>
    </div>
  );
}
