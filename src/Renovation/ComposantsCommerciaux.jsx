// ─────────────────────────────────────────────────────────────────────────────
// Composants partagés du lot 2 (Refonte Opérations) : badge de statut, fiche
// client, choix du client et du chargé d'affaires, « Marquer perdu » et son
// annulation. Utilisés par Opérations, Chantiers et Chiffrage.
//
// Les règles (champs obligatoires, motifs, transitions) viennent des modules
// purs reglesSaisieProgbat.mjs et statutsChantier.mjs : aucun de ces écrans
// n'a sa propre liste.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { X, AlertTriangle, Ban, Undo2, UserCircle, Briefcase } from "lucide-react";
import { STATUTS_AFFICHAGE, MOTIFS_PERTE, validerMotifPerte, libelleMotifPerte, STATUTS_OPERATION } from "./statutsChantier.js";
import { estObligatoire, controlerFiche, genererCodeClient, TYPES_CLIENT } from "./reglesSaisieProgbat.js";
import { FICHE_CLIENT_VIDE, enregistrerClient, libelleClient, nomCollaborateur } from "./clientsDonnees.js";
import { RessemblancesProgbat, NoteClientProgbat } from "./ClientsProgbat.jsx";
import { CHAMPS_RELUS_PROGBAT } from "./progbatAutomatisation.js";

const couleurs = (T = {}) => ({
  surface: T.surface || "#262a32", card: T.card || "rgba(255,255,255,0.04)", border: T.border || "rgba(255,255,255,0.1)",
  text: T.text || "#f0f0f0", textSub: T.textSub || "#9aa5c0", textMuted: T.textMuted || "#5b6a8a",
});

export function BadgeStatut({ statut, operation = false, title }) {
  const table = operation ? STATUTS_OPERATION : STATUTS_AFFICHAGE;
  const s = table[statut] || (operation ? STATUTS_OPERATION.vide : STATUTS_AFFICHAGE.planifie);
  return (
    <span title={title} style={{
      fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
      padding: "3px 10px", borderRadius: RADIUS.pill, color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`, whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function Modale({ T, titre, icone, onClose, children, largeur = 520 }) {
  const c = couleurs(T);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: RADIUS.xl, width: "100%", maxWidth: largeur, maxHeight: "92vh", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          {icone && <Icon as={icone} size={18} />}
          <div style={{ flex: 1, fontSize: FONT.lg.size, fontWeight: 800, color: c.text }}>{titre}</div>
          <button onClick={onClose} title="Fermer" style={{ background: "transparent", border: `1px solid ${c.border}`, borderRadius: RADIUS.md, width: 30, height: 30, cursor: "pointer", color: c.textSub, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={X} size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const styles = (T) => {
  const c = couleurs(T);
  return {
    c,
    lbl: { display: "block", fontSize: 11, fontWeight: 700, color: c.textSub, marginBottom: 5, textTransform: "uppercase", letterSpacing: .5 },
    inp: { width: "100%", padding: "9px 12px", background: c.card, border: `1px solid ${c.border}`, borderRadius: 7, color: c.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" },
    btn: { background: "#FFC300", color: "#000", border: "none", borderRadius: 7, padding: "9px 18px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: "pointer" },
    btnSec: { background: "transparent", color: c.textSub, border: `1px solid ${c.border}`, borderRadius: 7, padding: "8px 14px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" },
  };
};

/** Astérisque des champs obligatoires (règle unique). */
export const Asterisque = () => <span style={{ color: "#e15a5a", marginLeft: 3 }} title="Obligatoire">*</span>;

/** Liste de ce qui manque (refus d'enregistrement, bouton devis grisé). */
export function ListeManquants({ manquants, titre = "Il manque :", T }) {
  const c = couleurs(T);
  if (!manquants || manquants.length === 0) return null;
  return (
    <div style={{ padding: "10px 12px", borderRadius: RADIUS.md, background: "rgba(225,90,90,0.10)", border: "1px solid rgba(225,90,90,0.35)", fontSize: FONT.sm.size, color: c.text }}>
      <div style={{ fontWeight: 800, color: "#e15a5a", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon as={AlertTriangle} size={13} /> {titre}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        {manquants.map((m, i) => <li key={`${m.id || m.code || i}-${i}`}>{m.libelle || m.message || String(m)}</li>)}
      </ul>
    </div>
  );
}

// ─── Fiche client ────────────────────────────────────────────────────────────
/**
 * Création / modification d'une fiche client. Enregistrement refusé tant
 * qu'une règle n'est pas respectée (liste affichée).
 * onEnregistre(client) reçoit la ligne enregistrée.
 */
export function FicheClientModal({ T, client = null, initial = null, onClose, onEnregistre }) {
  const s = styles(T);
  const [fiche, setFiche] = useState(() => ({ ...FICHE_CLIENT_VIDE, ...(initial || {}), ...(client || {}) }));
  const [manquants, setManquants] = useState([]);
  const [erreur, setErreur] = useState("");
  const [busy, setBusy] = useState(false);
  const maj = (k, v) => setFiche((f) => ({ ...f, [k]: v }));
  const champ = (label, k, props = {}) => (
    <div style={props.span ? { gridColumn: "1 / -1" } : undefined}>
      <label style={s.lbl}>{label}{estObligatoire("client", k, fiche) && <Asterisque />}</label>
      <input style={s.inp} type={props.type || "text"} value={fiche[k] ?? ""} placeholder={props.placeholder || ""} onChange={(e) => maj(k, e.target.value)} />
    </div>
  );
  const code = genererCodeClient(fiche);
  // Lot 4 (demande de Loris du 06/11) : un NOUVEAU client montre d'abord les
  // clients ProGBat qui lui ressemblent ; enregistrer exige de les écarter.
  const nouveau = !client?.id;
  const [accuse, setAccuse] = useState(false);
  const [etatPg, setEtatPg] = useState({ ressemblances: 0 });
  const bloqueParProgbat = nouveau && etatPg.ressemblances > 0 && !accuse;
  const enregistrer = async () => {
    setErreur("");
    if (bloqueParProgbat) { setErreur("Ce client existe peut-être déjà dans ProGBat : choisir l'un des clients proposés, ou cocher « Aucun de ces clients ProGBat ne correspond »."); return; }
    const m = controlerFiche("client", fiche);
    setManquants(m);
    if (m.length) return;
    setBusy(true);
    const r = await enregistrerClient(fiche, { id: client?.id || null });
    setBusy(false);
    if (!r.ok) { setManquants(r.manquants || []); setErreur(r.erreur || ""); return; }
    onEnregistre?.(r.client);
  };
  return (
    <Modale T={T} titre={client?.id ? "Modifier la fiche client" : "Nouveau client"} icone={UserCircle} onClose={onClose} largeur={620}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={s.lbl}>Type de client<Asterisque /></label>
          <div style={{ display: "flex", gap: 8 }}>
            {TYPES_CLIENT.map((t) => (
              <button key={t.id} type="button" onClick={() => maj("type", t.id)} style={{ ...s.btnSec, flex: 1, fontWeight: 700, ...(fiche.type === t.id ? { background: "#FFC300", color: "#000", border: "1px solid #FFC300" } : {}) }}>{t.label}</button>
            ))}
          </div>
        </div>
        {fiche.type === "societe" ? <>
          {champ("Raison sociale", "raison_sociale", { placeholder: "SCI Les Tilleuls" })}
          {champ("Nom du contact", "contact_nom", { placeholder: "Jean Dupont" })}
        </> : fiche.type === "particulier" ? <>
          {champ("Nom", "nom", { placeholder: "Dupont" })}
          {champ("Prénom", "prenom", { placeholder: "Jean" })}
        </> : null}
        {champ("E-mail", "email", { type: "email", placeholder: "jean.dupont@mail.fr" })}
        {champ("Téléphone", "telephone", { type: "tel", placeholder: "06 12 34 56 78" })}
        {champ("Adresse de facturation", "adresse", { span: true, placeholder: "12 rue des Lilas" })}
        {champ("Complément", "adresse_complement", { placeholder: "Bâtiment B" })}
        {champ("Code postal", "code_postal", { placeholder: "49000" })}
        {champ("Ville", "ville", { placeholder: "Angers" })}
        {champ("Pays", "pays", { placeholder: "France" })}
        <div style={{ gridColumn: "1 / -1", fontSize: FONT.xs.size + 1, color: s.c.textMuted }}>
          Identifiant ProGBat généré : <strong style={{ color: s.c.text }}>{code || "— (nom et ville nécessaires)"}</strong>
        </div>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {nouveau && <RessemblancesProgbat T={T} fiche={fiche} accuse={accuse} setAccuse={setAccuse} onEtat={setEtatPg} onUtiliser={(c) => onEnregistre?.(c)} />}
        {!nouveau && client?.progbat_client_id && (
          <div style={{ fontSize: FONT.xs.size + 1, color: s.c.textMuted }}>Fiche reliée au client ProGBat n° {client.progbat_client_id} : la compléter ici ne modifie pas ProGBat. Prénom, e-mail et téléphone ne sont pas exigés pour un client qui existe déjà dans ProGBat.</div>
        )}
        {!nouveau && client?.progbat_client_id && (
          <NoteClientProgbat T={s.c} client={{ ...fiche, id: client.id }} onClient={(lu) => setFiche((f) => {
            // Ne complète que les champs encore vides du formulaire : rien de saisi n'est écrasé.
            const out = { ...f };
            for (const k of CHAMPS_RELUS_PROGBAT) if (!String(f[k] ?? "").trim() && String(lu?.[k] ?? "").trim()) out[k] = lu[k];
            if (String(lu?.prenom ?? "").trim() && !String(f.prenom ?? "").trim() && String(lu?.nom ?? "").trim() && String(f.nom ?? "").trim() === String(client.nom ?? "").trim()) out.nom = lu.nom;
            return out;
          })} />
        )}
        <ListeManquants T={T} manquants={manquants} titre="Enregistrement refusé, il manque :" />
        {erreur && <div style={{ color: "#e15a5a", fontSize: FONT.sm.size }}>Enregistrement impossible : {erreur}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={s.btnSec}>Annuler</button>
          <button onClick={enregistrer} disabled={busy} style={{ ...s.btn, opacity: busy ? .6 : 1 }}>{busy ? "Enregistrement…" : "Enregistrer le client"}</button>
        </div>
      </div>
    </Modale>
  );
}

/**
 * Choix d'un client existant ou création. `heritage` : libellé affiché quand
 * la valeur vide signifie « celui de l'opération ».
 */
export function ChoixClient({ T, clients = [], valeur = "", onChange, heritage = null, onNouveau, onProgbat, disabled = false }) {
  const s = styles(T);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select style={{ ...s.inp, cursor: disabled ? "not-allowed" : "pointer" }} disabled={disabled} value={valeur || ""} onChange={(e) => onChange?.(e.target.value || null)}>
        <option value="">{heritage ? `Comme l'opération : ${heritage}` : "— Choisir un client —"}</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{libelleClient(c)}{c.ville ? ` — ${c.ville}` : ""}</option>)}
      </select>
      {onProgbat && !disabled && <button type="button" onClick={onProgbat} title="Choisir parmi les clients qui existent déjà dans ProGBat (aucun doublon)" style={{ ...s.btnSec, whiteSpace: "nowrap" }}>Client ProGBat existant</button>}
      {onNouveau && !disabled && <button type="button" onClick={onNouveau} style={{ ...s.btnSec, whiteSpace: "nowrap" }}>+ Nouveau client</button>}
    </div>
  );
}

/**
 * Choix du chargé d'affaires parmi les collaborateurs (comptes actifs hors
 * ouvriers). onChange({ id, nom }) ; id null = « comme l'opération ».
 */
export function ChoixChargeAffaires({ T, collaborateurs = [], complete = true, valeur = "", nomEnregistre = "", onChange, heritage = null, disabled = false }) {
  const s = styles(T);
  const connu = !valeur || collaborateurs.some((u) => u.id === valeur);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon as={Briefcase} size={13} />
        <select style={{ ...s.inp, cursor: disabled ? "not-allowed" : "pointer" }} disabled={disabled} value={valeur || ""}
          onChange={(e) => {
            const u = collaborateurs.find((x) => x.id === e.target.value);
            onChange?.(u ? { id: u.id, nom: nomCollaborateur(u) } : { id: null, nom: null });
          }}>
          <option value="">{heritage ? `Comme l'opération : ${heritage}` : "— Choisir le chargé d'affaires —"}</option>
          {!connu && <option value={valeur}>{nomEnregistre || "Compte introuvable"}</option>}
          {collaborateurs.map((u) => <option key={u.id} value={u.id}>{nomCollaborateur(u)}</option>)}
        </select>
      </div>
      {!complete && (
        <div style={{ fontSize: FONT.xs.size, color: s.c.textMuted, marginTop: 4 }}>
          La liste complète des collaborateurs n'est visible que par un administrateur : vous pouvez vous désigner vous-même, ou demander à un administrateur de choisir.
        </div>
      )}
    </div>
  );
}

// ─── Marquer perdu / annuler ────────────────────────────────────────────────
export function MarquerPerduModal({ T, chantier, onClose, onValider }) {
  const s = styles(T);
  const [motif, setMotif] = useState("");
  const [detail, setDetail] = useState("");
  const [erreurs, setErreurs] = useState([]);
  const [busy, setBusy] = useState(false);
  const valider = async () => {
    const v = validerMotifPerte({ motif, detail });
    setErreurs(v.erreurs);
    if (!v.ok) return;
    setBusy(true);
    const r = await onValider({ motif, detail });
    setBusy(false);
    if (r && r.ok === false) setErreurs(r.erreurs || ["Enregistrement impossible"]);
  };
  return (
    <Modale T={T} titre={`Marquer perdu : ${chantier?.nom || ""}`} icone={Ban} onClose={onClose}>
      <div style={{ fontSize: FONT.sm.size, color: s.c.textSub, marginBottom: 12, lineHeight: 1.5 }}>
        Le chantier passe en « Perdu » : il ne reçoit plus aucune relance et n'apparaît plus que dans Opérations. La date et votre nom sont enregistrés. On peut annuler ensuite (avec une raison).
      </div>
      <label style={s.lbl}>Motif<Asterisque /></label>
      <select style={{ ...s.inp, marginBottom: 10 }} value={motif} onChange={(e) => setMotif(e.target.value)}>
        <option value="">— Choisir le motif —</option>
        {MOTIFS_PERTE.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <label style={s.lbl}>Précisions{motif === "autre" && <Asterisque />}</label>
      <textarea style={{ ...s.inp, minHeight: 70, resize: "vertical" }} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Ex : devis concurrent 15 % moins cher" />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <ListeManquants T={T} manquants={erreurs.map((e) => ({ libelle: e }))} titre="Impossible de marquer perdu :" />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={s.btnSec}>Annuler</button>
          <button onClick={valider} disabled={busy} style={{ ...s.btn, background: "#94a3b8", opacity: busy ? .6 : 1 }}>{busy ? "Enregistrement…" : "Marquer perdu"}</button>
        </div>
      </div>
    </Modale>
  );
}

export function AnnulerPerteModal({ T, chantier, onClose, onValider }) {
  const s = styles(T);
  const [raison, setRaison] = useState("");
  const [erreurs, setErreurs] = useState([]);
  const [busy, setBusy] = useState(false);
  const valider = async () => {
    if (!raison.trim()) { setErreurs(["Indiquer pourquoi la perte est annulée"]); return; }
    setBusy(true);
    const r = await onValider({ raison });
    setBusy(false);
    if (r && r.ok === false) setErreurs(r.erreurs || ["Enregistrement impossible"]);
  };
  return (
    <Modale T={T} titre={`Annuler « perdu » : ${chantier?.nom || ""}`} icone={Undo2} onClose={onClose}>
      <div style={{ fontSize: FONT.sm.size, color: s.c.textSub, marginBottom: 12, lineHeight: 1.5 }}>
        Perdu le {chantier?.perdu_le ? new Date(chantier.perdu_le).toLocaleDateString("fr-FR") : "?"}{chantier?.perdu_par ? ` par ${chantier.perdu_par}` : ""} — motif : {libelleMotifPerte(chantier?.perdu_motif) || "?"}{chantier?.perdu_motif_detail ? ` (${chantier.perdu_motif_detail})` : ""}.
        <br />Le chantier revient « À l'étude ». La perte et son annulation restent dans l'historique.
      </div>
      <label style={s.lbl}>Raison de l'annulation<Asterisque /></label>
      <textarea style={{ ...s.inp, minHeight: 60, resize: "vertical" }} value={raison} onChange={(e) => setRaison(e.target.value)} placeholder="Ex : le client revient vers nous" />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <ListeManquants T={T} manquants={erreurs.map((e) => ({ libelle: e }))} titre="Impossible d'annuler :" />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={s.btnSec}>Fermer</button>
          <button onClick={valider} disabled={busy} style={{ ...s.btn, opacity: busy ? .6 : 1 }}>{busy ? "Enregistrement…" : "Remettre à l'étude"}</button>
        </div>
      </div>
    </Modale>
  );
}

/** Ligne « Perdu le … par … — motif » (lecture). */
export function ResumePerte({ chantier, T }) {
  const c = couleurs(T);
  if (!chantier?.perdu_le && !chantier?.perdu_motif) return null;
  return (
    <div style={{ fontSize: FONT.xs.size + 1, color: c.textSub }}>
      Perdu le {chantier.perdu_le ? new Date(chantier.perdu_le).toLocaleDateString("fr-FR") : "?"}{chantier.perdu_par ? ` par ${chantier.perdu_par}` : ""} — {libelleMotifPerte(chantier.perdu_motif) || "motif inconnu"}{chantier.perdu_motif_detail ? ` : ${chantier.perdu_motif_detail}` : ""}
    </div>
  );
}
