// ─────────────────────────────────────────────────────────────────────────────
// Page bureau « Justificatifs entreprise » (tâche 9 du projet
// docs/projets/fiche-securite-chantier.md). Visible : admin (attribution
// automatique) et conducteur (configuration en base, accord de François du
// 25/11/2026).
//
// Justificatifs permanents de Profero : habilitations électriques, formations
// SS4 et échafaudage, aptitudes médicales (administrateurs seulement), DUERP,
// modes opératoires amiante, consigne de travail isolé, Kbis, attestations…
//
//   - colonnes : personne, type, date, expiration, statut ; tri par
//     expiration la plus proche (module pur securiteEntreprise.mjs) ;
//   - statut : lu dans la vue securite_justificatifs_expiration (elle fait
//     foi) ; vue illisible = « statut illisible », jamais « valide » ;
//   - ajout (photo ou fichier) : non confidentiel → chantier-documents sous
//     securite/entreprise/{type}/ ; aptitude médicale → bucket
//     securite-confidentiel, proposé aux administrateurs seulement ;
//   - retrait = archivage (archive_le), jamais suppression ;
//   - un non-administrateur ne voit jamais une aptitude médicale (ni ligne,
//     ni compte) : la base ne la lui renvoie pas, et la page filtre aussi.
// Ces justificatifs sont rattachés automatiquement aux fiches sécurité des
// chantiers (securiteValidation.mjs, justificatifsEntrepriseRattaches).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FONT, RADIUS, SPACING, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { ShieldCheck, Plus, Camera, Paperclip, Lock } from "lucide-react";
import { libelleJustificatif } from "./securite/points.js";
import {
  lignesJustificatifsEntreprise, comptesParEtat, filtrerLignes, personnesDistinctes, typesProposesEntreprise,
  preparerJustificatifEntreprise, estTypeConfidentiel,
} from "./securiteEntreprise.js";
import {
  chargerJustificatifsEntreprisePage, ajouterJustificatifEntreprise, archiverJustificatif, urlJustificatifEntreprise, dateDuJourLocale,
} from "./securiteDonnees.js";
import { ACCEPT_DOCS } from "./storageChantier.js";

const ROUGE = "#e15a5a", ORANGE = "#b97a10", VERT = "#15803d";
const COULEUR_ETAT = { valide: VERT, expire_bientot: ORANGE, expire: ROUGE, sans_expiration: null, inconnu: ROUGE };
const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR") : "");

export default function PageJustificatifsEntreprise({ T, branch = "renovation", profil = null }) {
  const acc = getBranchAccent(branch);
  const estAdmin = profil?.role === "admin"; // même règle que is_admin() en base
  const auteur = profil?.nom || profil?.email || null;
  const [donnees, setDonnees] = useState({ charge: false, liste: null, etats: null, erreur: null, erreurEtats: null });
  const [filtres, setFiltres] = useState({ personne: "", type: "" });
  const [ajout, setAjout] = useState(null);
  const [fichier, setFichier] = useState(null);
  const [envoi, setEnvoi] = useState({ enCours: false, erreurs: [] });
  const [message, setMessage] = useState(null);
  const photoRef = useRef(null);
  const fichierRef = useRef(null);

  const charger = useCallback(() => {
    setDonnees((d) => ({ ...d, charge: false }));
    return chargerJustificatifsEntreprisePage()
      .then((r) => setDonnees({ charge: true, ...r }))
      .catch((e) => setDonnees({ charge: true, liste: null, etats: null, erreur: e?.message || String(e), erreurEtats: null }));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const lignes = donnees.charge ? lignesJustificatifsEntreprise({ justificatifs: donnees.liste, etats: donnees.etats, estAdmin }) : null;
  const visibles = filtrerLignes(lignes, filtres);
  const comptes = comptesParEtat(lignes);
  const personnes = personnesDistinctes(lignes);
  const types = typesProposesEntreprise(estAdmin);

  const ouvrirAjout = () => {
    setAjout({ type_code: types[0], personne: "", entreprise_nom: "Profero", date_document: dateDuJourLocale(), expire_le: "" });
    setFichier(null); setEnvoi({ enCours: false, erreurs: [] });
  };
  const envoyer = async () => {
    const prep = preparerJustificatifEntreprise({ form: ajout, aFichier: !!fichier, estAdmin });
    if (!prep.ok) { setEnvoi({ enCours: false, erreurs: prep.erreurs }); return; }
    setEnvoi({ enCours: true, erreurs: [] });
    const r = await ajouterJustificatifEntreprise({ ligne: prep.ligne, fichier, auteur });
    if (r.erreur) { setEnvoi({ enCours: false, erreurs: [`Ajout impossible : ${r.erreur}.`] }); return; }
    setAjout(null); setFichier(null); setEnvoi({ enCours: false, erreurs: [] });
    setMessage(`« ${libelleJustificatif(r.ligne.type_code)} » ajouté.`);
    await charger();
  };
  const archiver = async (j) => {
    if (!window.confirm(`Retirer « ${libelleJustificatif(j.type_code)}${j.personne ? ` — ${j.personne}` : ""} » ?\nLe document n'est pas supprimé : il est archivé. Il ne sera plus rattaché aux fiches sécurité qui n'ont pas encore été validées.`)) return;
    const r = await archiverJustificatif(j.id);
    setMessage(r.erreur ? `Retrait impossible : ${r.erreur}.` : "Document retiré (archivé).");
    await charger();
  };
  const ouvrir = async (j) => {
    const fenetre = window.open("", "_blank");
    const r = await urlJustificatifEntreprise(j);
    if (r.url) { if (fenetre) fenetre.location.href = r.url; else window.location.assign(r.url); setMessage(null); }
    else { fenetre?.close(); setMessage(`Ouverture impossible : ${r.erreur}.`); }
  };

  const page = { flex: 1, minHeight: 0, overflowY: "auto", background: T.bg, color: T.text, fontFamily: "inherit", padding: SPACING.lg, paddingBottom: 96, maxWidth: 1000, margin: "0 auto", boxSizing: "border-box" };
  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 16px", marginBottom: SPACING.sm };
  const label = { display: "block", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSub, marginBottom: 6 };
  const input = { width: "100%", boxSizing: "border-box", padding: "9px 11px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, color: T.text, fontSize: 14, fontFamily: "inherit", outline: "none" };
  const bouton = (actif = true) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 38, borderRadius: RADIUS.md,
    border: `1px solid ${actif ? acc.border : T.border}`, background: actif ? acc.bg10 : "transparent", color: actif ? acc.accent : T.textMuted,
    fontWeight: 700, fontSize: 13, cursor: actif ? "pointer" : "default", fontFamily: "inherit" });
  const th = { textAlign: "left", padding: "8px 10px", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${T.border}` };
  const td = { padding: "9px 10px", fontSize: 13.5, borderBottom: `1px solid ${T.border}`, verticalAlign: "top" };

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Icon as={ShieldCheck} size={22} style={{ color: acc.accent }}/>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Justificatifs entreprise</h1>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13.5, color: T.textSub }}>
        Documents permanents de Profero : habilitations, formations, {estAdmin ? "aptitudes médicales (visibles des seuls administrateurs), " : ""}DUERP, modes opératoires…
        Un document valide est rattaché automatiquement aux fiches sécurité des chantiers qui l'attendent.
      </p>

      <div style={card}>
        {!donnees.charge ? (
          <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Chargement…</div>
        ) : donnees.erreur ? (
          <div style={{ fontSize: 13, color: ROUGE, fontWeight: 700 }}>Justificatifs illisibles ({donnees.erreur}) : la liste ne peut pas être affichée. <button onClick={charger} style={{ ...bouton(), marginLeft: 8 }}>Réessayer</button></div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 13.5, marginBottom: 10 }}>
              <span><b style={{ color: ROUGE }}>{comptes.expire}</b> expiré{comptes.expire > 1 ? "s" : ""}</span>
              <span><b style={{ color: ORANGE }}>{comptes.expire_bientot}</b> expire{comptes.expire_bientot > 1 ? "nt" : ""} sous 30 jours</span>
              <span><b style={{ color: VERT }}>{comptes.valide}</b> valide{comptes.valide > 1 ? "s" : ""}</span>
              <span><b>{comptes.sans_expiration}</b> sans date d'expiration</span>
              {comptes.inconnu > 0 && <span style={{ color: ROUGE, fontWeight: 700 }}>{comptes.inconnu} statut{comptes.inconnu > 1 ? "s" : ""} illisible{comptes.inconnu > 1 ? "s" : ""}</span>}
            </div>
            {donnees.erreurEtats && (
              <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600, marginBottom: 8 }}>
                Statuts d'expiration illisibles ({donnees.erreurEtats}) : les documents datés s'affichent « statut illisible ».
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
              <div style={{ minWidth: 180 }}>
                <label style={label}>Personne</label>
                <select value={filtres.personne} onChange={(e) => { const v = e.target.value; setFiltres((f) => ({ ...f, personne: v })); }} style={input}>
                  <option value="">Toutes</option>
                  {personnes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 220 }}>
                <label style={label}>Type</label>
                <select value={filtres.type} onChange={(e) => { const v = e.target.value; setFiltres((f) => ({ ...f, type: v })); }} style={input}>
                  <option value="">Tous</option>
                  {types.map((t) => <option key={t} value={t}>{libelleJustificatif(t)}</option>)}
                </select>
              </div>
              {!ajout && <button onClick={ouvrirAjout} style={{ ...bouton(), marginLeft: "auto" }}><Icon as={Plus} size={14}/> Ajouter un justificatif</button>}
            </div>

            {ajout && (
              <div style={{ padding: "12px 14px", borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                  <div>
                    <label style={label}>Type de document</label>
                    <select value={ajout.type_code} disabled={envoi.enCours} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, type_code: v })); }} style={input}>
                      {types.map((t) => <option key={t} value={t}>{libelleJustificatif(t)}</option>)}
                    </select>
                  </div>
                  <div><label style={label}>Personne concernée</label><input value={ajout.personne} disabled={envoi.enCours} style={input} placeholder="prénom et nom" onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, personne: v })); }}/></div>
                  <div><label style={label}>Entreprise</label><input value={ajout.entreprise_nom} disabled={envoi.enCours} style={input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, entreprise_nom: v })); }}/></div>
                  <div><label style={label}>Date du document</label><input type="date" value={ajout.date_document} disabled={envoi.enCours} style={input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, date_document: v })); }}/></div>
                  <div><label style={label}>Expire le</label><input type="date" value={ajout.expire_le} disabled={envoi.enCours} style={input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, expire_le: v })); }}/></div>
                </div>
                {estTypeConfidentiel(ajout.type_code) && (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: T.textSub, display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon as={Lock} size={13}/> Document confidentiel : rangé à part, lisible par les seuls administrateurs. Il n'apparaît jamais sur les fiches des chantiers.
                  </div>
                )}
                <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => setFichier(e.target.files?.[0] || null)}/>
                <input ref={fichierRef} type="file" accept={ACCEPT_DOCS} style={{ display: "none" }} onChange={(e) => setFichier(e.target.files?.[0] || null)}/>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button onClick={() => photoRef.current?.click()} disabled={envoi.enCours} style={bouton(!envoi.enCours)}><Icon as={Camera} size={14}/> Prendre une photo</button>
                  <button onClick={() => fichierRef.current?.click()} disabled={envoi.enCours} style={bouton(!envoi.enCours)}><Icon as={Paperclip} size={14}/> Choisir un fichier</button>
                  <span style={{ fontSize: 12.5, color: fichier ? T.text : T.textMuted, fontStyle: fichier ? "normal" : "italic" }}>{fichier ? fichier.name : "aucun fichier choisi"}</span>
                </div>
                {envoi.erreurs.length > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>{envoi.erreurs.map((m, i) => <div key={i}>{m}</div>)}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                  <button onClick={() => setAjout(null)} disabled={envoi.enCours} style={{ ...bouton(false), cursor: "pointer" }}>Annuler</button>
                  <button onClick={envoyer} disabled={envoi.enCours} style={bouton(!envoi.enCours)}>{envoi.enCours ? "Envoi…" : "Enregistrer le document"}</button>
                </div>
              </div>
            )}
            {message && <div style={{ fontSize: 13, color: /impossible/.test(message) ? ROUGE : T.textSub, fontWeight: 600, marginBottom: 8 }}>{message}</div>}

            {lignes && lignes.length === 0 ? (
              <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Aucun justificatif enregistré dans l'espace entreprise pour l'instant.</div>
            ) : visibles.length === 0 ? (
              <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Aucun justificatif pour ce filtre.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                  <thead>
                    <tr><th style={th}>Personne</th><th style={th}>Type</th><th style={th}>Date</th><th style={th}>Expiration</th><th style={th}>Statut</th><th style={th}></th></tr>
                  </thead>
                  <tbody>
                    {visibles.map(({ justificatif: j, etat, libelleEtat, libelleType }) => (
                      <tr key={j.id}>
                        <td style={td}>{j.personne || <span style={{ color: T.textMuted, fontStyle: "italic" }}>—</span>}{j.entreprise_nom ? <div style={{ fontSize: 12, color: T.textMuted }}>{j.entreprise_nom}</div> : null}</td>
                        <td style={td}>
                          <button onClick={() => ouvrir(j)} title="Ouvrir le document" style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textAlign: "left", fontSize: 13.5 }}>
                            {libelleType}
                          </button>
                          {j.confidentiel && <span style={{ marginLeft: 6, fontSize: 11.5, color: T.textMuted }}><Icon as={Lock} size={11}/> confidentiel</span>}
                          {j.fichier_nom && <div style={{ fontSize: 12, color: T.textMuted }}>{j.fichier_nom}</div>}
                        </td>
                        <td style={td}>{j.date_document ? dateFr(j.date_document) : <span style={{ color: T.textMuted }}>non renseignée</span>}</td>
                        <td style={td}>{j.expire_le ? dateFr(j.expire_le) : <span style={{ color: T.textMuted }}>—</span>}</td>
                        <td style={{ ...td, fontWeight: 700, color: COULEUR_ETAT[etat] || T.textSub }}>{libelleEtat}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <button onClick={() => archiver(j)} title="Retirer (le document est archivé, pas supprimé)" style={{ border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, borderRadius: 8, padding: "4px 9px", minHeight: 32, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>Retirer</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
