// ─────────────────────────────────────────────────────────────────────────────
// Signature électronique simple de la fiche sécurité (tâche 4 du projet
// docs/projets/fiche-securite-chantier.md) : « établie par » et « chef
// d'équipe ». Tracé au doigt, au stylet ou à la souris (Pointer Events), sur
// un canvas maison : pas de nouvelle dépendance (la bibliothèque signature_pad
// n'est pas dans le projet, et un tracé simple suffit à une signature non
// qualifiée). L'image est exportée en PNG sur fond blanc.
//
// Avant le tracé : la synthèse des risques, le texte d'engagement de la
// spécification, la version et l'empreinte du contenu signé.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Eraser, X } from "lucide-react";
import { TEXTE_ENGAGEMENT } from "./securiteValidation.js";
import { empreinteCourte } from "./securiteVersion.js";

const LARGEUR = 600, HAUTEUR = 220; // repère logique du tracé

function ZoneTrace({ T, onChange, canvasRef }) {
  const trace = useRef({ actif: false, dernier: null });

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  }, [canvasRef]);

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * LARGEUR, ((e.clientY - r.top) / r.height) * HAUTEUR];
  };
  const debut = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    trace.current = { actif: true, dernier: point(e) };
    const ctx = canvasRef.current.getContext("2d");
    const [x, y] = trace.current.dernier;
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
    onChange(true);
  };
  const deplacement = (e) => {
    if (!trace.current.actif) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = point(e);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(...trace.current.dernier);
    ctx.lineTo(...p);
    ctx.stroke();
    trace.current.dernier = p;
  };
  const fin = () => { trace.current = { actif: false, dernier: null }; };

  return (
    <canvas ref={canvasRef} width={LARGEUR} height={HAUTEUR}
      onPointerDown={debut} onPointerMove={deplacement} onPointerUp={fin} onPointerCancel={fin} onPointerLeave={fin}
      aria-label="Zone de signature : signez au doigt, au stylet ou à la souris"
      style={{ width: "100%", aspectRatio: `${LARGEUR} / ${HAUTEUR}`, touchAction: "none", background: "#fff",
        border: `2px dashed ${T.border}`, borderRadius: RADIUS.lg, cursor: "crosshair", display: "block" }}/>
  );
}

/**
 * @param {object} p
 * @param {string} p.libelle        « Établie par » / « Chef d'équipe »
 * @param {number} p.version
 * @param {string} p.empreinte
 * @param {string[]} p.synthese     risques principaux (point 3)
 * @param {string?} p.nomConnecte   nom de l'utilisateur connecté (pré-rempli)
 * @param {boolean} p.pourMoiParDefaut
 * @param {(v) => Promise<string|null>} p.onSigner  renvoie un message d'erreur ou null
 * @param {boolean} p.nomFige       tâche 8 : ouvrier connecté, nom et entreprise
 *                                  non modifiables, pas de case « je signe moi-même »
 * @param {React.ReactNode} p.consignes tâche 8 : consignes affichées sous les risques
 * @param {string?} p.note          remplace la note sous le tracé
 */
export default function SignatureFicheSecurite({ T, acc, libelle, version, empreinte, synthese = [], nomConnecte = "", pourMoiParDefaut = false, entrepriseParDefaut = "", onSigner, onAnnuler, nomFige = false, consignes = null, note = null }) {
  const canvasRef = useRef(null);
  const [pourMoi, setPourMoi] = useState(!!((pourMoiParDefaut || nomFige) && nomConnecte));
  const [nom, setNom] = useState((pourMoiParDefaut || nomFige) && nomConnecte ? nomConnecte : "");
  const [entreprise, setEntreprise] = useState(entrepriseParDefaut);
  const [aTrace, setATrace] = useState(false);
  const [envoi, setEnvoi] = useState({ enCours: false, erreur: null });

  const effacer = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    setATrace(false);
  };

  const signer = async () => {
    if (!nom.trim()) { setEnvoi({ enCours: false, erreur: "Nom du signataire obligatoire." }); return; }
    if (!aTrace) { setEnvoi({ enCours: false, erreur: "Signez dans le cadre blanc." }); return; }
    setEnvoi({ enCours: true, erreur: null });
    const png = await new Promise((ok) => canvasRef.current.toBlob(ok, "image/png"));
    if (!png) { setEnvoi({ enCours: false, erreur: "Image de signature impossible à produire." }); return; }
    const erreur = await onSigner({ nom: nom.trim(), entreprise: entreprise.trim(), pourMoi, png });
    if (erreur) setEnvoi({ enCours: false, erreur });
  };

  const input = { width: "100%", boxSizing: "border-box", padding: "9px 10px", minHeight: 40, borderRadius: 8, border: `1px solid ${T.border}`,
    background: T.inputBg || T.surface, color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none" };
  const label = { fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, marginBottom: 4, display: "block" };
  const lignes = (Array.isArray(synthese) ? synthese : []).filter((l) => typeof l === "string" && l.trim());

  return (
    <div onClick={envoi.enCours ? undefined : onAnnuler} style={{ position: "fixed", inset: 0, zIndex: 830, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label={`Signature — ${libelle}`} onClick={(e) => e.stopPropagation()}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, width: "min(680px, 100%)", maxHeight: "94vh", overflowY: "auto", padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, fontWeight: 800, fontSize: FONT.lg.size, color: T.text }}>Signature « {libelle} » — v{version}</div>
          <button onClick={onAnnuler} disabled={envoi.enCours} title="Annuler" style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon as={X} size={18}/></button>
        </div>

        <div style={{ padding: "10px 12px", borderRadius: 10, background: T.card || "transparent", border: `1px solid ${T.border}`, marginBottom: 12 }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Risques principaux du chantier</div>
          {lignes.length ? (
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: T.text }}>{lignes.map((l, i) => <li key={i}>{l}</li>)}</ol>
          ) : <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Aucun risque saisi.</div>}
          {consignes}
        </div>

        <div className="sfs-grille" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
          <div>
            <label style={label}>Nom du signataire</label>
            <input value={nom} disabled={pourMoi || nomFige || envoi.enCours} onChange={(e) => setNom(e.target.value)} style={input} placeholder="Prénom Nom"/>
          </div>
          <div>
            <label style={label}>Entreprise</label>
            <input value={entreprise} disabled={nomFige || envoi.enCours} onChange={(e) => setEntreprise(e.target.value)} style={input} placeholder="Entreprise"/>
          </div>
        </div>
        {nomConnecte && !nomFige ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub, marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={pourMoi} disabled={envoi.enCours} style={{ width: 18, height: 18, accentColor: acc.accent }}
              onChange={(e) => { const v = e.target.checked; setPourMoi(v); setNom(v ? nomConnecte : ""); }}/>
            Je signe moi-même ({nomConnecte}, compte connecté). Décochez si une autre personne signe sur cet appareil.
          </label>
        ) : null}

        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: "6px 0 8px" }}>{TEXTE_ENGAGEMENT}</div>
        <ZoneTrace T={T} canvasRef={canvasRef} onChange={setATrace}/>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <button onClick={effacer} disabled={envoi.enCours} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 38, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
            <Icon as={Eraser} size={14}/> Effacer
          </button>
          <span style={{ flex: 1, fontSize: 11.5, color: T.textMuted }}>
            {note || `Signature sur la v${version}, contenu d'empreinte ${empreinteCourte(empreinte)}… Toute modification de la fiche après la signature demandera de signer à nouveau.`}
          </span>
        </div>

        {envoi.erreur && <div style={{ marginTop: 10, fontSize: 13, color: "#e15a5a", fontWeight: 600 }}>{envoi.erreur}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button onClick={onAnnuler} disabled={envoi.enCours} style={{ padding: "10px 16px", minHeight: 42, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Annuler</button>
          <button onClick={signer} disabled={envoi.enCours} style={{ padding: "10px 18px", minHeight: 42, borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, cursor: envoi.enCours ? "default" : "pointer", fontFamily: "inherit" }}>
            {envoi.enCours ? "Enregistrement…" : "Signer"}
          </button>
        </div>
        <style>{`@media(max-width:560px) { .sfs-grille { grid-template-columns: 1fr !important; } }`}</style>
      </div>
    </div>
  );
}
