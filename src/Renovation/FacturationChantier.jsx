// ─────────────────────────────────────────────────────────────────────────────
// BLOC « FACTURATION CLIENT » de la fiche chantier.
//
// La personne en charge de la facturation dépose ici les factures au fur et à
// mesure. Chaque import suit toujours le même chemin, dans cet ordre :
//
//   1. le PDF part dans le bucket privé "chantier-documents" (il doit rester
//      attaché à la facture, quoi qu'il arrive ensuite) ;
//   2. la tâche IA "facture_client" LIT le document (numéro, date, montants,
//      mentions) — via /api/ai, qui journalise, plafonne et quota l'appel ;
//   3. le rapprochement avec l'échéancier est fait ICI, en clair et sans
//      modèle : rapprocherFacture() (src/Renovation/facturationClient.mjs) ;
//   4. une fenêtre de confirmation montre ce qui a été lu, l'échéance
//      proposée et POURQUOI — tout reste modifiable avant enregistrement.
//
// Le point 4 n'est pas négociable : une lecture automatique ne coche pas une
// ligne d'argent toute seule. En revanche, une fois la facture enregistrée,
// tout le reste est automatique — la frise du cycle de vie suit, et
// l'encaissement de l'acompte coche « Acompte encaissé ».
//
// Ce composant n'appelle jamais computeCycleVie ni n'écrit dans meta : il
// remonte ses écritures à PageChantiers (onRefresh), seul détenteur du
// read-before-write sur le phasage.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import {
  Receipt, Upload, Check, X, Loader2, AlertTriangle, Paperclip,
  Pencil, Banknote, Plus, RotateCcw, FileText,
} from "lucide-react";
import {
  uploadDocumentChantier, urlDocumentChantier, supprimerDocumentChantier,
  derniereErreurDocument,
} from "./storageChantier";
import {
  normaliserEcheancier, rapprocherFacture, factureDoublon,
  montantAttenduLigne, FACT_META_ECHEANCIER, FACT_META_MONTANT_REF,
} from "./facturationClient";

const ACCEPT_FACTURE = "application/pdf,image/*";

const eur = (n) => `${Math.round(parseFloat(n) || 0).toLocaleString("fr-FR")} €`;
const jj = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const auj = () => new Date().toISOString().slice(0, 10);
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const STATUT_STYLE = {
  attente:   { label: "prévue",     couleur: "#8a94ad", plein: false },
  a_emettre: { label: "à émettre",  couleur: "#f59e0b", plein: true  },
  emise:     { label: "émise",      couleur: "#4db8ff", plein: true  },
  encaissee: { label: "encaissée",  couleur: "#22c55e", plein: true  },
};

const DECLENCHEURS = [
  { type: "signature",  label: "À la signature du devis" },
  { type: "avancement", label: "À un % d'avancement" },
  { type: "reception",  label: "À la réception des travaux" },
  { type: "manuel",     label: "À la main (aucun signalement)" },
];

// Appel de la tâche IA de lecture de facture. Renvoie l'extrait, ou lève —
// l'appelant doit pouvoir continuer à la main en cas d'échec : un document
// illisible ne doit jamais empêcher d'enregistrer une facture.
async function lireFacture(documentPath, chantierId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Session expirée : reconnectez-vous.");
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({
      tache: "facture_client",
      entree: { document_path: documentPath },
      contexte: { chantier_id: chantierId, branche: "renovation", entite_type: "facture_client" },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data?.erreur?.message || `Lecture impossible (HTTP ${res.status}).`);
  return { extrait: data.resultat || {}, confianceLecture: data.confiance ?? null };
}

// ─── Fenêtre de confirmation d'un import ─────────────────────────────────────
// Montre ce qui a été LU, ce qui est PROPOSÉ et pourquoi. Tout est modifiable.
function ModaleImport({ brouillon, lignes, montantReference, factures, T, onAnnuler, onEnregistrer }) {
  const [champs, setChamps] = useState(() => ({
    numero: brouillon.extrait?.numero || "",
    date_facture: brouillon.extrait?.date_facture || auj(),
    montant_ht: brouillon.extrait?.montant_ht ?? "",
    montant_tva: brouillon.extrait?.montant_tva ?? "",
    montant_ttc: brouillon.extrait?.montant_ttc ?? "",
  }));
  const [ligneId, setLigneId] = useState(brouillon.proposition?.ligneId || "");
  const [busy, setBusy] = useState(false);
  // Import lancé depuis UNE échéance précise : ce choix tient, la proposition
  // automatique ne le remplace pas (elle reste affichée, en dessous).
  const [ligneTouchee, setLigneTouchee] = useState(!!brouillon.cible);

  // Le rapprochement se rejoue à chaque correction du montant : corriger un
  // montant mal lu doit reproposer la bonne échéance, pas figer la première.
  const propositionCourante = React.useMemo(() => rapprocherFacture(
    { ...brouillon.extrait, montant_ht: toNum(champs.montant_ht) },
    { echeancier: lignes, montantReference, factures }
  ), [champs.montant_ht, brouillon.extrait, lignes, montantReference, factures]);

  React.useEffect(() => {
    if (!ligneTouchee && propositionCourante.ligneId) setLigneId(propositionCourante.ligneId);
  }, [propositionCourante.ligneId, ligneTouchee]);

  const doublon = factureDoublon({ numero: champs.numero }, factures);
  const ligneChoisie = lignes.find(l => l.id === ligneId) || null;
  const attendu = ligneChoisie ? montantAttenduLigne(ligneChoisie, montantReference) : null;
  const montantHt = toNum(champs.montant_ht);
  const ecart = attendu !== null && montantHt !== null ? Math.round((montantHt - attendu) * 100) / 100 : null;
  const lectureRatee = !!brouillon.erreurLecture;

  const inputStyle = {
    padding: "7px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
    background: T.inputBg || "transparent", color: T.text, fontSize: FONT.sm.size,
    fontFamily: "inherit", outline: "none", width: "100%",
  };
  const labelStyle = { fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, marginBottom: 4, display: "block" };

  const enregistrer = async () => {
    setBusy(true);
    await onEnregistrer({
      numero: champs.numero.trim() || null,
      date_facture: champs.date_facture || null,
      montant_ht: toNum(champs.montant_ht),
      montant_tva: toNum(champs.montant_tva),
      montant_ttc: toNum(champs.montant_ttc),
      ligne_id: ligneId || null,
      ligne_nom: ligneChoisie?.nom || null,
      pct_du_marche: montantHt !== null && montantReference > 0
        ? Math.round((montantHt / montantReference) * 1000) / 10 : null,
      confiance: propositionCourante.confiance,
      rapprochement: !ligneId ? "manuel"
        : ligneId === propositionCourante.ligneId ? "auto" : "corrige",
      raison: ligneId === propositionCourante.ligneId
        ? propositionCourante.raison
        : `Échéance choisie à la main. Proposition automatique : ${propositionCourante.raison}`,
      extraction: { ...brouillon.extrait, _confiance_lecture: brouillon.confianceLecture ?? null },
    });
    setBusy(false);
  };

  return (
    <>
      <div onClick={busy ? undefined : onAnnuler} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200 }}/>
      <div style={{
        position: "fixed", zIndex: 1201, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(620px, 94vw)", maxHeight: "92vh", overflowY: "auto",
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl,
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)", padding: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <Icon as={Receipt} size={17} color="#4db8ff"/>
          <span style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Facture lue</span>
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 14, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={Paperclip} size={11}/> {brouillon.doc?.nom}
        </div>

        {lectureRatee && (
          <div style={{
            display: "flex", gap: 8, padding: "10px 12px", marginBottom: 14, borderRadius: RADIUS.md,
            background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)",
            fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600,
          }}>
            <Icon as={AlertTriangle} size={14} style={{ flexShrink: 0, marginTop: 1 }}/>
            <span>Lecture automatique impossible ({brouillon.erreurLecture}). Le document est bien enregistré :
            saisissez le montant et l'échéance à la main.</span>
          </div>
        )}

        {doublon && (
          <div style={{
            display: "flex", gap: 8, padding: "10px 12px", marginBottom: 14, borderRadius: RADIUS.md,
            background: "rgba(225,90,90,0.12)", border: "1px solid rgba(225,90,90,0.45)",
            fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 600,
          }}>
            <Icon as={AlertTriangle} size={14} style={{ flexShrink: 0, marginTop: 1 }}/>
            <span>Le numéro « {champs.numero} » est déjà enregistré sur ce chantier
            ({eur(doublon.montant_ht)}{doublon.date_facture ? `, ${jj(doublon.date_facture)}` : ""}).
            Vérifiez qu'il ne s'agit pas d'un doublon.</span>
          </div>
        )}

        {/* Ce qui a été lu — modifiable */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Numéro de facture</label>
            <input value={champs.numero} onChange={e => setChamps(c => ({ ...c, numero: e.target.value }))} style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>Date d'émission</label>
            <input type="date" value={champs.date_facture} onChange={e => setChamps(c => ({ ...c, date_facture: e.target.value }))} style={inputStyle}/>
          </div>
          <div>
            <label style={labelStyle}>Montant HT</label>
            <input type="number" step="0.01" value={champs.montant_ht}
              onChange={e => setChamps(c => ({ ...c, montant_ht: e.target.value }))}
              style={{ ...inputStyle, fontWeight: 800 }}/>
          </div>
          <div>
            <label style={labelStyle}>Montant TTC</label>
            <input type="number" step="0.01" value={champs.montant_ttc}
              onChange={e => setChamps(c => ({ ...c, montant_ttc: e.target.value }))} style={inputStyle}/>
          </div>
        </div>

        {/* L'échéance : proposée, toujours modifiable */}
        <div style={{
          padding: 13, borderRadius: RADIUS.lg, border: `1px solid ${T.border}`,
          background: T.bg, marginBottom: 16,
        }}>
          <label style={labelStyle}>Échéance du contrat</label>
          <select value={ligneId} onChange={e => { setLigneTouchee(true); setLigneId(e.target.value); }} style={inputStyle}>
            <option value="">— Aucune (facture hors échéancier) —</option>
            {lignes.map(l => {
              const prise = factures.some(f => f.ligne_id === l.id && f.statut !== "annulee");
              return (
                <option key={l.id} value={l.id}>
                  {l.nom} — {l.pct} % ({eur(montantAttenduLigne(l, montantReference))}){prise ? " · déjà facturée" : ""}
                </option>
              );
            })}
          </select>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 7, lineHeight: 1.5 }}>
            {propositionCourante.raison}
            {propositionCourante.pctDuMarche !== null && (
              <> {" "}<strong style={{ color: T.textSub }}>Soit {propositionCourante.pctDuMarche} % du marché.</strong></>
            )}
          </div>
          {ecart !== null && Math.abs(ecart) >= 1 && (
            <div style={{ fontSize: FONT.xs.size + 1, color: "#f59e0b", marginTop: 5, fontWeight: 700 }}>
              Écart de {eur(Math.abs(ecart))} {ecart > 0 ? "au-dessus" : "en dessous"} du montant attendu ({eur(attendu)}).
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
          <button onClick={onAnnuler} disabled={busy} style={{
            padding: "9px 16px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontSize: FONT.sm.size, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit",
          }}>Annuler</button>
          <button onClick={enregistrer} disabled={busy} style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
            background: busy ? T.textMuted : "#22c55e", color: "#fff",
            fontSize: FONT.sm.size, fontWeight: 800,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit",
          }}>
            <Icon as={busy ? Loader2 : Check} size={14}/>
            {busy ? "Enregistrement…" : "Enregistrer la facture"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Fenêtre d'encaissement ──────────────────────────────────────────────────
function ModaleEncaissement({ facture, ligneNom, T, onAnnuler, onValider }) {
  const [date, setDate] = useState(auj());
  const [montant, setMontant] = useState(facture.montant_ht ?? "");
  const [busy, setBusy] = useState(false);
  const inputStyle = {
    padding: "7px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
    background: T.inputBg || "transparent", color: T.text, fontSize: FONT.sm.size,
    fontFamily: "inherit", outline: "none", width: "100%",
  };
  return (
    <>
      <div onClick={busy ? undefined : onAnnuler} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200 }}/>
      <div style={{
        position: "fixed", zIndex: 1201, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(420px, 94vw)", background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: RADIUS.xl, boxShadow: "0 20px 60px rgba(0,0,0,0.45)", padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <Icon as={Banknote} size={17} color="#22c55e"/>
          <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: T.text }}>Encaissement</span>
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 16 }}>
          {ligneNom}{facture.numero ? ` · facture n° ${facture.numero}` : ""} — émise {jj(facture.date_facture) || "sans date"}.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <div>
            <label style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, marginBottom: 4, display: "block" }}>Date d'encaissement</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle}/>
          </div>
          <div>
            <label style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, marginBottom: 4, display: "block" }}>Montant reçu</label>
            <input type="number" step="0.01" value={montant} onChange={e => setMontant(e.target.value)} style={inputStyle}/>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
          <button onClick={onAnnuler} disabled={busy} style={{
            padding: "9px 16px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontSize: FONT.sm.size, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit",
          }}>Annuler</button>
          <button onClick={async () => { setBusy(true); await onValider({ date, montant: toNum(montant) }); setBusy(false); }}
            disabled={busy || !date} style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
              background: busy || !date ? T.textMuted : "#22c55e", color: "#fff",
              fontSize: FONT.sm.size, fontWeight: 800,
              cursor: busy || !date ? "default" : "pointer", fontFamily: "inherit",
            }}>
            <Icon as={busy ? Loader2 : Check} size={14}/>{busy ? "Enregistrement…" : "Confirmer"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Édition de l'échéancier du chantier ─────────────────────────────────────
// Surcharge locale : tant qu'on n'a rien touché, le chantier suit le réglage
// Admin (et bénéficie de ses évolutions). Dès qu'on enregistre ici,
// l'échéancier est FIGÉ sur ce chantier — un contrat signé ne doit pas changer
// de découpage parce qu'un réglage général a bougé. Le retour au réglage
// général reste possible en un clic.
function EditeurEcheancier({ lignes, surcharge, montantReference, T, onAnnuler, onEnregistrer, onReinitialiser }) {
  const [draft, setDraft] = useState(() => lignes.map(l => ({ ...l })));
  const [busy, setBusy] = useState(false);
  const somme = Math.round(draft.reduce((s, l) => s + (toNum(l.pct) || 0), 0) * 100) / 100;

  const maj = (i, patch) => setDraft(d => d.map((l, j) => j === i ? { ...l, ...patch } : l));
  const inputStyle = {
    padding: "6px 9px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
    background: T.inputBg || "transparent", color: T.text, fontSize: FONT.sm.size,
    fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: RADIUS.lg, border: `1px dashed ${T.border}`, background: T.bg }}>
      <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text, marginBottom: 10 }}>
        Échéancier de ce chantier
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {draft.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <input value={l.nom} onChange={e => maj(i, { nom: e.target.value })}
              placeholder="Libellé" style={{ ...inputStyle, flex: "1 1 180px", minWidth: 140 }}/>
            <input type="number" min="0" step="1" value={l.pct} onChange={e => maj(i, { pct: e.target.value })}
              style={{ ...inputStyle, width: 70, textAlign: "center", fontWeight: 800 }}/>
            <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, width: 78 }}>
              % · {eur(montantAttenduLigne({ pct: toNum(l.pct) || 0 }, montantReference))}
            </span>
            <select value={l.declencheur?.type || "manuel"}
              onChange={e => maj(i, { declencheur: { type: e.target.value, seuil: l.declencheur?.seuil ?? 50 } })}
              style={{ ...inputStyle, flex: "0 1 200px" }}>
              {DECLENCHEURS.map(d => <option key={d.type} value={d.type}>{d.label}</option>)}
            </select>
            {l.declencheur?.type === "avancement" && (
              <input type="number" min="0" max="100" value={l.declencheur?.seuil ?? 0}
                onChange={e => maj(i, { declencheur: { type: "avancement", seuil: e.target.value } })}
                style={{ ...inputStyle, width: 62, textAlign: "center" }} title="Seuil d'avancement (%)"/>
            )}
            <button onClick={() => setDraft(d => d.filter((_, j) => j !== i))}
              title="Retirer cette échéance" style={{
                background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
                width: 28, height: 28, color: T.textMuted, cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}><Icon as={X} size={13}/></button>
          </div>
        ))}
      </div>

      <button onClick={() => setDraft(d => [...d, { id: `echeance_${d.length + 1}`, nom: "Nouvelle échéance", pct: 0, declencheur: { type: "manuel" } }])}
        style={{
          marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
          padding: "6px 12px", color: T.textSub, fontSize: FONT.xs.size + 1, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}><Icon as={Plus} size={12}/> Ajouter une échéance</button>

      <div style={{
        marginTop: 12, fontSize: FONT.xs.size + 1, fontWeight: 700,
        color: somme === 100 ? "#22c55e" : "#f59e0b",
      }}>
        Total : {somme} %{somme !== 100 ? ` — l'échéancier ${somme < 100 ? "ne couvre pas" : "dépasse"} le marché.` : " du marché."}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={async () => { setBusy(true); await onEnregistrer(draft); setBusy(false); }} disabled={busy} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 15px", borderRadius: RADIUS.md, border: "none",
          background: busy ? T.textMuted : "#22c55e", color: "#fff",
          fontSize: FONT.sm.size, fontWeight: 800, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
        }}><Icon as={Check} size={13}/> Enregistrer pour ce chantier</button>
        {surcharge && (
          <button onClick={async () => { setBusy(true); await onReinitialiser(); setBusy(false); }} disabled={busy} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 15px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontSize: FONT.sm.size, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit",
          }}><Icon as={RotateCcw} size={13}/> Revenir au réglage général</button>
        )}
        <button onClick={onAnnuler} disabled={busy} style={{
          padding: "8px 15px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
          background: "transparent", color: T.textMuted, fontSize: FONT.sm.size, fontWeight: 700,
          cursor: busy ? "default" : "pointer", fontFamily: "inherit",
        }}>Fermer</button>
      </div>
    </div>
  );
}

// ─── BLOC PRINCIPAL ──────────────────────────────────────────────────────────
export default function FacturationChantier({
  T, chantierId, phasageId, etat, echeancier, echeancierSurcharge, montantRef, factures,
  peutModifier, auteur, onRefresh, onSaveMeta,
}) {
  const [busy, setBusy] = useState("");          // libellé de l'opération en cours
  const [erreur, setErreur] = useState("");
  const [brouillon, setBrouillon] = useState(null);      // import en attente de confirmation
  const [encaissement, setEncaissement] = useState(null); // { facture, ligneNom }
  const [editerEcheancier, setEditerEcheancier] = useState(false);
  const [editerMontant, setEditerMontant] = useState(false);
  const [montantSaisi, setMontantSaisi] = useState("");
  const fileRef = useRef(null);
  const ligneCibleRef = useRef(null); // échéance visée quand on importe depuis une ligne

  const border = T?.border || "rgba(255,255,255,0.07)";
  const text = T?.text || "#f0f0f0";
  const textSub = T?.textSub || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const ref = montantRef?.montant || 0;
  const totaux = etat?.totaux || {};

  // ── Import : upload → lecture IA → rapprochement → confirmation ──
  const choisirFichier = (ligneId = null) => {
    if (!peutModifier) return;
    ligneCibleRef.current = ligneId;
    setErreur("");
    fileRef.current?.click();
  };

  const importer = async (file) => {
    if (!file) return;
    const ligneCible = ligneCibleRef.current;
    ligneCibleRef.current = null;
    setErreur("");
    setBusy("Envoi du document…");
    const doc = await uploadDocumentChantier(file, `factures-client/${chantierId}`);
    if (!doc) {
      setBusy("");
      setErreur(derniereErreurDocument() || "Envoi du document impossible.");
      return;
    }
    setBusy("Lecture de la facture…");
    let extrait = {}, confianceLecture = null, erreurLecture = "";
    try {
      const lu = await lireFacture(doc.path, chantierId);
      extrait = lu.extrait || {};
      confianceLecture = lu.confianceLecture;
    } catch (e) {
      erreurLecture = e.message || "erreur inconnue";
    }
    const proposition = rapprocherFacture(extrait, {
      echeancier, montantReference: ref, factures,
    });
    setBusy("");
    setBrouillon({
      doc, extrait, confianceLecture, erreurLecture,
      cible: ligneCible || null,
      proposition: ligneCible ? { ...proposition, ligneId: ligneCible } : proposition,
    });
  };

  // Abandon d'un import : le document envoyé repart avec lui (on ne laisse pas
  // de fichier orphelin dans le bucket).
  const annulerImport = async () => {
    if (brouillon?.doc?.path) await supprimerDocumentChantier(brouillon.doc.path);
    setBrouillon(null);
  };

  const enregistrerFacture = async (valeurs) => {
    const { error } = await supabase.from("chantier_factures_client").insert({
      chantier_id: chantierId,
      phasage_id: phasageId || null,
      statut: "emise",
      document_path: brouillon.doc.path,
      document_nom: brouillon.doc.nom,
      cree_par: auteur || null,
      ...valeurs,
    });
    if (error) {
      // 23505 = l'index unique (chantier, numéro) a parlé : deux imports
      // simultanés passent la vérification côté écran, pas celle de la base.
      setErreur(error.code === "23505"
        ? `Une facture portant le numéro « ${valeurs.numero} » existe déjà sur ce chantier.`
        : `Enregistrement impossible : ${error.message}`);
      return;
    }
    setBrouillon(null);
    await onRefresh?.();
  };

  const encaisser = async ({ date, montant }) => {
    const { error } = await supabase.from("chantier_factures_client")
      .update({ statut: "encaissee", date_encaissement: date, montant_encaisse: montant })
      .eq("id", encaissement.facture.id);
    if (error) { setErreur(`Encaissement impossible : ${error.message}`); return; }
    setEncaissement(null);
    await onRefresh?.();
  };

  const annulerEncaissement = async (facture) => {
    if (!window.confirm("Annuler l'encaissement de cette facture ? Elle redeviendra « émise ».")) return;
    setBusy("Mise à jour…");
    const { error } = await supabase.from("chantier_factures_client")
      .update({ statut: "emise", date_encaissement: null, montant_encaisse: null })
      .eq("id", facture.id);
    setBusy("");
    if (error) { setErreur(`Mise à jour impossible : ${error.message}`); return; }
    await onRefresh?.();
  };

  const supprimerFacture = async (facture) => {
    if (!window.confirm(`Supprimer la facture ${facture.numero ? `n° ${facture.numero}` : ""} (${eur(facture.montant_ht)}) ? Le document joint sera supprimé lui aussi.`)) return;
    setBusy("Suppression…");
    const { error } = await supabase.from("chantier_factures_client").delete().eq("id", facture.id);
    if (!error && facture.document_path) await supprimerDocumentChantier(facture.document_path);
    setBusy("");
    if (error) { setErreur(`Suppression impossible : ${error.message}`); return; }
    await onRefresh?.();
  };

  const ouvrirDocument = async (facture) => {
    if (!facture.document_path) return;
    const fenetre = window.open("", "_blank");
    const url = await urlDocumentChantier(facture.document_path);
    if (url) { if (fenetre) fenetre.location = url; else window.open(url, "_blank"); }
    else { if (fenetre) fenetre.close(); alert(derniereErreurDocument() || "Document introuvable."); }
  };

  // ── Réglages du chantier (meta du phasage) ──
  const enregistrerEcheancier = async (lignes) => {
    const ok = await onSaveMeta?.({
      [FACT_META_ECHEANCIER]: {
        lignes: normaliserEcheancier(lignes),
        auteur: auteur || "", date: new Date().toISOString(),
      },
    });
    if (ok !== false) setEditerEcheancier(false);
  };
  const reinitialiserEcheancier = async () => {
    const ok = await onSaveMeta?.({ [FACT_META_ECHEANCIER]: null });
    if (ok !== false) setEditerEcheancier(false);
  };
  const enregistrerMontant = async () => {
    const v = toNum(montantSaisi);
    await onSaveMeta?.({ [FACT_META_MONTANT_REF]: v && v > 0 ? v : null });
    setEditerMontant(false);
  };

  const btn = (couleur) => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    background: "transparent", border: `1px solid ${couleur || border}`,
    borderRadius: RADIUS.md, padding: "4px 10px",
    color: couleur || textSub, fontSize: FONT.xs.size + 1, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  });

  const kpi = (label, valeur, sous, couleur) => (
    <div style={{ flex: "1 1 130px", minWidth: 120 }}>
      <div style={{ fontSize: FONT.xs.size, color: textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .6 }}>{label}</div>
      <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: couleur || text, marginTop: 2 }}>{valeur}</div>
      {sous && <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 1 }}>{sous}</div>}
    </div>
  );

  return (
    <div className="ch-stat-card">
      <input ref={fileRef} type="file" accept={ACCEPT_FACTURE} style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; importer(f); }}/>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap",
        fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
        letterSpacing: 1.2, textTransform: "uppercase",
      }}>
        Facturation client
        <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", opacity: .7 }}>
          — importez les factures au fil de l'eau : le montant est lu, l'échéance reconnue, la frise suit
        </span>
        {peutModifier && (
          <button onClick={() => choisirFichier(null)} disabled={!!busy} style={{
            ...btn("#4db8ff"), marginLeft: "auto", letterSpacing: 0, textTransform: "none",
            padding: "6px 13px", opacity: busy ? .6 : 1,
          }}>
            <Icon as={busy ? Loader2 : Upload} size={13}/>{busy || "Importer une facture"}
          </button>
        )}
      </div>

      {erreur && (
        <div style={{
          display: "flex", gap: 8, padding: "9px 12px", marginBottom: 12, borderRadius: RADIUS.md,
          background: "rgba(225,90,90,0.12)", border: "1px solid rgba(225,90,90,0.4)",
          fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 600,
        }}>
          <Icon as={AlertTriangle} size={13} style={{ flexShrink: 0, marginTop: 1 }}/>{erreur}
        </div>
      )}

      {/* ── Marché de référence + totaux ── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ flex: "1 1 150px", minWidth: 130 }}>
          <div style={{ fontSize: FONT.xs.size, color: textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .6 }}>Marché HT</div>
          {editerMontant ? (
            <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 3 }}>
              <input type="number" step="0.01" value={montantSaisi} autoFocus
                onChange={e => setMontantSaisi(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") enregistrerMontant(); if (e.key === "Escape") setEditerMontant(false); }}
                placeholder={String(montantRef?.auto || 0)}
                style={{
                  width: 110, padding: "4px 8px", borderRadius: RADIUS.md, border: `1px solid ${border}`,
                  background: T.inputBg || "transparent", color: text, fontSize: FONT.sm.size,
                  fontWeight: 800, fontFamily: "inherit", outline: "none",
                }}/>
              <button onClick={enregistrerMontant} style={btn("#22c55e")}><Icon as={Check} size={12}/></button>
              <button onClick={() => setEditerMontant(false)} style={btn()}><Icon as={X} size={12}/></button>
            </div>
          ) : (
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, marginTop: 2, display: "flex", alignItems: "center", gap: 7 }}>
              {ref > 0 ? eur(ref) : "—"}
              {peutModifier && (
                <button onClick={() => { setMontantSaisi(ref ? String(ref) : ""); setEditerMontant(true); }}
                  title="Corriger le montant du marché" style={{
                    background: "transparent", border: "none", color: textMuted,
                    cursor: "pointer", padding: 0, display: "inline-flex",
                  }}><Icon as={Pencil} size={12}/></button>
              )}
            </div>
          )}
          <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 1 }}>
            {montantRef?.source === "saisi" ? "saisi à la main" : "somme des ouvrages du phasage"}
          </div>
        </div>
        {kpi("Facturé", eur(totaux.emis), totaux.pctEmis !== null ? `${totaux.pctEmis} % du marché` : null, "#4db8ff")}
        {kpi("Encaissé", eur(totaux.encaisse), totaux.pctEncaisse !== null ? `${totaux.pctEncaisse} % du marché` : null, "#22c55e")}
        {kpi("Reste à facturer", eur(totaux.resteAFacturer),
          totaux.resteAEncaisser > 0 ? `${eur(totaux.resteAEncaisser)} en attente de paiement` : null,
          totaux.resteAFacturer > 0 ? text : "#22c55e")}
      </div>

      {/* Barre : encaissé / émis / marché */}
      {ref > 0 && (
        <div style={{ height: 8, borderRadius: 4, background: border, overflow: "hidden", display: "flex", marginBottom: 6 }}>
          <div style={{ width: `${Math.min(100, (totaux.encaisse / ref) * 100)}%`, background: "#22c55e" }}/>
          <div style={{ width: `${Math.max(0, Math.min(100 - (totaux.encaisse / ref) * 100, ((totaux.emis - totaux.encaisse) / ref) * 100))}%`, background: "#4db8ff" }}/>
        </div>
      )}
      {ref <= 0 && (
        <div style={{
          display: "flex", gap: 8, padding: "9px 12px", marginBottom: 10, borderRadius: RADIUS.md,
          background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)",
          fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600,
        }}>
          <Icon as={AlertTriangle} size={13} style={{ flexShrink: 0, marginTop: 1 }}/>
          Aucun montant de marché : les pourcentages ne peuvent pas être calculés et les factures
          devront être rattachées à la main. Renseignez le marché HT ci-dessus.
        </div>
      )}

      {/* ── Les échéances ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
        {(etat?.lignes || []).map(l => {
          const st = STATUT_STYLE[l.statut] || STATUT_STYLE.attente;
          const f = l.facture;
          return (
            <div key={l.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "10px 12px", borderRadius: RADIUS.lg,
              border: `1px solid ${l.prete ? "#f59e0b55" : border}`,
              background: l.prete ? "rgba(245,158,11,0.07)" : "transparent",
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: l.statut === "encaissee" ? "#22c55e" : "transparent",
                border: `2px solid ${st.plein ? st.couleur : border}`,
              }}>{l.statut === "encaissee" ? <Icon as={Check} size={10} color="#fff"/> : null}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: text }}>{l.nom}</span>
                  <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: textSub }}>{l.pct} %</span>
                  <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>{eur(l.montantAttendu)}</span>
                  <span style={{
                    fontSize: 9.5, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase",
                    color: st.couleur, border: `1px ${st.plein ? "solid" : "dashed"} ${st.couleur}${st.plein ? "88" : "55"}`,
                    background: st.plein ? `${st.couleur}14` : "transparent",
                    borderRadius: RADIUS.pill, padding: "1px 8px",
                  }}>{st.label}</span>
                </div>
                <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 2 }}>{l.raison}</div>
                {l.ecart !== 0 && f && (
                  <div style={{ fontSize: FONT.xs.size + 1, color: "#f59e0b", marginTop: 2, fontWeight: 700 }}>
                    Facturé {eur(l.montantEmis)} — écart de {eur(Math.abs(l.ecart))} {l.ecart > 0 ? "au-dessus" : "en dessous"} de l'attendu.
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap", alignItems: "center" }}>
                  {l.factures.map(fac => (
                    <button key={fac.id} onClick={() => ouvrirDocument(fac)}
                      title="Ouvrir la facture" style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "2px 9px",
                        background: "transparent", color: textSub, fontSize: FONT.xs.size + 1,
                        cursor: fac.document_path ? "pointer" : "default", fontFamily: "inherit",
                      }}>
                      <Icon as={FileText} size={10}/>
                      {fac.numero ? `n° ${fac.numero}` : "facture"} · {eur(fac.montant_ht)}
                    </button>
                  ))}
                  {peutModifier && (
                    <>
                      {!f && (
                        <button onClick={() => choisirFichier(l.id)} disabled={!!busy} style={btn("#4db8ff")}>
                          <Icon as={Upload} size={11}/> Importer la facture
                        </button>
                      )}
                      {f && f.statut === "emise" && (
                        <button onClick={() => setEncaissement({ facture: f, ligneNom: l.nom })} style={btn("#22c55e")}>
                          <Icon as={Banknote} size={11}/> Marquer encaissée
                        </button>
                      )}
                      {f && f.statut === "encaissee" && (
                        <button onClick={() => annulerEncaissement(f)} style={btn()}>
                          <Icon as={RotateCcw} size={11}/> Annuler l'encaissement
                        </button>
                      )}
                      {f && (
                        <button onClick={() => supprimerFacture(f)} title="Supprimer cette facture" style={btn()}>
                          <Icon as={X} size={11}/>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Factures hors échéancier ── */}
      {(etat?.horsEcheancier || []).length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${border}` }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: textMuted, letterSpacing: .5, textTransform: "uppercase", marginBottom: 7 }}>
            Hors échéancier
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {etat.horsEcheancier.map(f => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => ouvrirDocument(f)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4, background: "transparent",
                  border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "2px 9px",
                  color: textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Icon as={FileText} size={10}/>{f.numero ? `n° ${f.numero}` : "facture"} · {eur(f.montant_ht)}
                </button>
                <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
                  {jj(f.date_facture)} · {f.statut === "encaissee" ? "encaissée" : "émise"} · rattachée à aucune échéance
                </span>
                {peutModifier && (
                  <button onClick={() => supprimerFacture(f)} style={btn()}><Icon as={X} size={11}/></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Échéancier : alertes + réglage ── */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {(etat?.controle?.alertes || []).map((a, i) => (
          <span key={i} style={{ fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600 }}>
            <Icon as={AlertTriangle} size={11} style={{ verticalAlign: "-2px", marginRight: 4 }}/>{a}
          </span>
        ))}
        {echeancierSurcharge && (
          <span title="Cet échéancier est figé sur ce chantier : le réglage général n'y touche plus."
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: FONT.xs.size, fontWeight: 700, padding: "2px 9px", borderRadius: RADIUS.pill,
              color: textSub, border: `1px dashed ${border}`,
            }}>
            <Icon as={Pencil} size={10}/> échéancier propre à ce chantier
          </span>
        )}
        {peutModifier && !editerEcheancier && (
          <button onClick={() => setEditerEcheancier(true)} style={{ ...btn(), marginLeft: "auto" }}>
            <Icon as={Pencil} size={11}/> Modifier l'échéancier
          </button>
        )}
      </div>

      {editerEcheancier && (
        <EditeurEcheancier lignes={echeancier} surcharge={!!echeancierSurcharge}
          montantReference={ref} T={T}
          onAnnuler={() => setEditerEcheancier(false)}
          onEnregistrer={enregistrerEcheancier}
          onReinitialiser={reinitialiserEcheancier}/>
      )}

      {brouillon && (
        <ModaleImport brouillon={brouillon} lignes={echeancier} montantReference={ref}
          factures={factures} T={T} onAnnuler={annulerImport} onEnregistrer={enregistrerFacture}/>
      )}
      {encaissement && (
        <ModaleEncaissement facture={encaissement.facture} ligneNom={encaissement.ligneNom} T={T}
          onAnnuler={() => setEncaissement(null)} onValider={encaisser}/>
      )}
    </div>
  );
}
