// ─────────────────────────────────────────────────────────────────────────────
// Panneau « Fiche sécurité » de la page Opération (tâche 2 du projet
// docs/projets/fiche-securite-chantier.md). Page bureau : l'espace ouvrier n'a
// pas la page Opérations.
//
//   - bloc « Bâtiment » éditable (table securite_operations, une ligne par
//     opération) : saisi une fois ici, repris en lecture dans chaque fiche ;
//   - liste des chantiers de l'opération (non archivés), chacun avec la
//     pastille de sa fiche (règle : securitePastilles.mjs, module pur) ;
//   - tâche 4 : pastille rouge « justificatifs manquants » / « expiré »,
//     calculée par la MÊME règle que la fiche (securiteValidation.mjs,
//     justificatifsPourPastille) ; si les justificatifs sont illisibles, aucun
//     rouge n'est inventé et le panneau le dit ;
//   - tâche 3 : bouton « Créer la fiche » (seulement quand la pastille dit
//     « à créer » : jamais pour un chantier terminé ou perdu, jamais quand
//     l'état est illisible) et « Ouvrir la fiche » → FicheSecuriteChantier.
//
// Une lecture en échec reste visible : « état illisible », jamais « à créer » ;
// le bloc Bâtiment ne s'édite pas tant que sa lecture n'a pas réussi (sinon un
// enregistrement écraserait des données qu'on n'a pas vues).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import { FONT, RADIUS, LOTS_DEFAUT, loadLots } from "../constants";
import { Icon } from "../ui";
import { ShieldCheck, Building2, X } from "lucide-react";
import { estChantierArchive } from "./chantierActif.js";
import {
  pastilleFicheSecurite, REPERAGE_AMIANTE_STATUTS, NON_RENSEIGNE,
  texteOuiNon, texteEtage, texteAvantDate, libelleReperageAmiante,
  formulaireBatiment, preparerEnregistrementBatiment,
} from "./securitePastilles.js";
import { chargerEtatFiches, chargerBatiment, enregistrerBatiment, creerFiche, chargerJustificatifsPastilles, dateDuJourLocale, chargerDonneesMiseAJourProposee } from "./securiteDonnees.js";
import { propositionsMiseAJour } from "./securiteAccueil.js";
import { peutCreerFiche } from "./securiteFiche.js";
import FicheSecuriteChantier from "./FicheSecuriteChantier.jsx";
import { alerteChantierEnCours } from "./securiteCycleVie.js";
import { synchroniserEtapeFicheSecurite } from "./securiteCycleVieDonnees.js";

function Pastille({ p }) {
  return (
    <span title={p.detail || undefined} style={{
      fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: RADIUS.pill,
      color: p.couleur, background: p.ton === "pointille" ? "transparent" : `color-mix(in srgb, ${p.couleur} 14%, transparent)`,
      border: `1px ${p.ton === "pointille" ? "dashed" : "solid"} ${p.couleur}`,
      whiteSpace: "nowrap", flexShrink: 0,
    }}>{p.libelle}</span>
  );
}

function BlocBatiment({ T, acc, op, auteur }) {
  const [lecture, setLecture] = useState({ charge: false, ligne: null, erreur: null });
  const [form, setForm] = useState(formulaireBatiment(null));
  const [modifie, setModifie] = useState(false);
  const [envoi, setEnvoi] = useState({ enCours: false, erreurs: [], ok: false });

  const charger = () => {
    let actif = true;
    setLecture({ charge: false, ligne: null, erreur: null });
    chargerBatiment(op.id).then((r) => {
      if (!actif) return;
      setLecture({ charge: true, ligne: r.ligne, erreur: r.erreur });
      setForm(formulaireBatiment(r.ligne));
      setModifie(false);
    });
    return () => { actif = false; };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(charger, [op.id]);

  const champ = (cle) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [cle]: v }));
    setModifie(true);
    setEnvoi((s) => ({ ...s, ok: false, erreurs: [] }));
  };

  const enregistrer = async () => {
    const prep = preparerEnregistrementBatiment(op.id, form);
    if (!prep.ok) { setEnvoi({ enCours: false, erreurs: prep.erreurs, ok: false }); return; }
    setEnvoi({ enCours: true, erreurs: [], ok: false });
    const r = await enregistrerBatiment(prep.ligne, auteur);
    if (r.erreur) { setEnvoi({ enCours: false, erreurs: [`Enregistrement impossible : ${r.erreur}. Rien n'a été modifié.`], ok: false }); return; }
    setLecture({ charge: true, ligne: r.ligne, erreur: null });
    setForm(formulaireBatiment(r.ligne));
    setModifie(false);
    setEnvoi({ enCours: false, erreurs: [], ok: true });
  };

  const label = { fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, marginBottom: 4, display: "block" };
  const input = {
    width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`,
    background: T.inputBg || T.surface, color: T.text, fontFamily: "inherit", fontSize: 13, outline: "none",
  };
  const ouiNonSelect = (cle) => (
    <select value={form[cle]} onChange={champ(cle)} style={input}>
      <option value="">{NON_RENSEIGNE}</option>
      <option value="oui">oui</option>
      <option value="non">non</option>
    </select>
  );
  const l = lecture.ligne;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.lg || 12, padding: "12px 16px", marginBottom: 14, background: T.card || "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon as={Building2} size={15} color={acc.accent}/>
        <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>
          Bâtiment <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>— saisi une fois pour toute l'opération, repris dans la fiche de chaque chantier</span>
        </div>
      </div>

      {!lecture.charge ? (
        <div style={{ fontSize: FONT.sm.size, color: T.textMuted, fontStyle: "italic" }}>Chargement…</div>
      ) : lecture.erreur ? (
        <div style={{ fontSize: FONT.sm.size, color: "#e15a5a", fontWeight: 600 }}>
          Données du bâtiment illisibles ({lecture.erreur}). Elles ne sont pas modifiables tant qu'elles n'ont pas pu être lues.{" "}
          <button onClick={charger} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>Réessayer</button>
        </div>
      ) : (
        <>
          <div className="fso-grille" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div>
              <label style={label}>Date du permis de construire</label>
              <input type="date" value={form.date_permis_construire} onChange={champ("date_permis_construire")} style={input}/>
            </div>
            <div>
              <label style={label}>Copropriété</label>
              {ouiNonSelect("copropriete")}
            </div>
            <div>
              <label style={label}>Étage (0 = rez-de-chaussée)</label>
              <input type="number" min={-5} max={60} step={1} value={form.etage} placeholder={NON_RENSEIGNE} onChange={champ("etage")} style={input}/>
            </div>
            <div>
              <label style={label}>Ascenseur utilisable</label>
              {ouiNonSelect("ascenseur_utilisable")}
            </div>
            <div style={{ gridColumn: "span 2" }} className="fso-large">
              <label style={label}>Repérage amiante</label>
              <select value={form.reperage_amiante_statut} onChange={champ("reperage_amiante_statut")} style={input}>
                {REPERAGE_AMIANTE_STATUTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={label}>Notes</label>
              <textarea value={form.notes} onChange={champ("notes")} rows={2} style={{ ...input, resize: "vertical" }}
                placeholder="Accès, stationnement, contraintes de la copropriété…"/>
            </div>
          </div>

          {/* Valeurs ENREGISTRÉES (pas la saisie en cours) : « avant 1997 /
              avant 1949 » sont calculés par la base à partir de la date. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 10, fontSize: FONT.xs.size + 1, color: T.textSub }}>
            <span>Permis avant le 1er juillet 1997 : <b style={{ color: T.text }}>{texteAvantDate(l?.avant_1997, l?.date_permis_construire)}</b></span>
            <span>Permis avant 1949 : <b style={{ color: T.text }}>{texteAvantDate(l?.avant_1949, l?.date_permis_construire)}</b></span>
            {!l && <span style={{ fontStyle: "italic", color: T.textMuted }}>Rien n'a encore été enregistré pour ce bâtiment.</span>}
            {l && (
              <span style={{ color: T.textMuted }}>
                Enregistré : copropriété {texteOuiNon(l.copropriete)} · {texteEtage(l.etage)} · ascenseur {texteOuiNon(l.ascenseur_utilisable)} · amiante : {libelleReperageAmiante(l.reperage_amiante_statut).toLowerCase()}
              </span>
            )}
          </div>

          {envoi.erreurs.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#e15a5a", fontWeight: 600 }}>
              {envoi.erreurs.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
            {modifie ? (
              <span style={{ fontSize: FONT.xs.size + 1, color: "#b97a10", fontWeight: 600 }}>Modifications non enregistrées</span>
            ) : envoi.ok ? (
              <span style={{ fontSize: FONT.xs.size + 1, color: "#15803d", fontWeight: 600 }}>Enregistré</span>
            ) : null}
            <button onClick={enregistrer} disabled={!modifie || envoi.enCours} style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 14px",
              borderRadius: RADIUS.md, border: `1px solid ${modifie ? acc.border : T.border}`,
              background: modifie ? acc.bg10 : "transparent", color: modifie ? acc.accent : T.textMuted,
              fontWeight: 700, fontSize: FONT.sm.size, cursor: modifie && !envoi.enCours ? "pointer" : "default", fontFamily: "inherit",
            }}>
              {envoi.enCours ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function FicheSecuriteOperation({ T, acc, op, chantiersOp = [], profil = null, onClose }) {
  const chantiersListes = chantiersOp.filter((c) => !estChantierArchive(c));
  const ids = chantiersListes.map((c) => c.id).join("|");
  const [etat, setEtat] = useState({ lecture: "chargement", parChantier: {}, erreur: null });
  const [justifs, setJustifs] = useState({ parChantier: {}, erreur: null });

  const chargerFiches = () => {
    let actif = true;
    setEtat({ lecture: "chargement", parChantier: {}, erreur: null });
    setJustifs({ parChantier: {}, erreur: null });
    const liste = ids ? ids.split("|") : [];
    chargerEtatFiches(liste).then((r) => {
      if (!actif) return;
      setEtat({ lecture: r.erreur ? "erreur" : "ok", parChantier: r.parChantier, erreur: r.erreur });
    });
    chargerJustificatifsPastilles(liste, dateDuJourLocale()).then((r) => {
      if (actif) setJustifs({ parChantier: r.parChantier, erreur: r.erreur });
    });
    return () => { actif = false; };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(chargerFiches, [ids]);

  // Tâche 8 : « Mise à jour proposée » pour les fiches validées (ou à mettre à
  // jour) : nouveau prestataire au planning, lot ajouté au phasage qui change
  // un statut proposé, justificatif requis expiré. Lecture seule.
  const [majProposees, setMajProposees] = useState({});
  useEffect(() => {
    if (etat.lecture !== "ok") { setMajProposees({}); return undefined; }
    let actif = true;
    const cibles = chantiersListes.filter((c) => ["validee", "a_mettre_a_jour"].includes(etat.parChantier[c.id]?.statut));
    if (!cibles.length) { setMajProposees({}); return undefined; }
    const aujourdhui = dateDuJourLocale();
    loadLots().catch(() => null).then((l) => {
      const lots = Array.isArray(l) && l.length ? l : LOTS_DEFAUT;
      cibles.forEach((c) => {
        chargerDonneesMiseAJourProposee({ chantier: c, op }).then((d) => {
          if (!actif) return;
          const res = d.erreur ? { erreur: d.erreur } : propositionsMiseAJour({ fiche: d.fiche, sources: d.sources, lots, justificatifs: d.justificatifs, justificatifsEntreprise: d.justificatifsEntreprise, aujourdhui });
          setMajProposees((m) => ({ ...m, [c.id]: res }));
        }).catch((e) => actif && setMajProposees((m) => ({ ...m, [c.id]: { erreur: e?.message || String(e) } })));
      });
    });
    return () => { actif = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat, op.id]);

  // Fiche d'un chantier ouverte par-dessus le panneau (tâche 3).
  const [ficheOuverte, setFicheOuverte] = useState(null); // chantier
  const [ouvrirEnMiseAJour, setOuvrirEnMiseAJour] = useState(false);
  const [creation, setCreation] = useState({ chantierId: null, erreur: null });
  const ficheOuverteRef = useRef(null);
  ficheOuverteRef.current = ficheOuverte;

  useEffect(() => {
    const echap = (e) => { if (e.key === "Escape" && !ficheOuverteRef.current) onClose?.(); };
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onClose]);

  const auteur = profil?.nom || profil?.email || null;

  const creer = async (c) => {
    if (creation.chantierId) return;
    setCreation({ chantierId: c.id, erreur: null });
    const r = await creerFiche(c.id, auteur);
    if (r.erreur || !r.ligne) {
      setCreation({ chantierId: null, erreur: `${c.nom} : création impossible (${r.erreur || "fiche non relue"}). Aucune fiche n'a été créée.` });
      return;
    }
    setCreation({ chantierId: null, erreur: null });
    synchroniserEtapeFicheSecurite({ chantierId: c.id, auteur: auteur || "" }); // tâche 7 : étape du cycle de vie
    setFicheOuverte(c);
  };
  const fermerFiche = () => { setFicheOuverte(null); setOuvrirEnMiseAJour(false); chargerFiches(); };

  const boutonLigne = (actif) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", minHeight: 36, flexShrink: 0,
    borderRadius: RADIUS.md, border: `1px solid ${actif ? acc.border : T.border}`, background: actif ? acc.bg10 : "transparent",
    color: actif ? acc.accent : T.textMuted, fontWeight: 700, fontSize: 12, cursor: actif ? "pointer" : "default", fontFamily: "inherit",
  });

  return (
    <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@media(max-width:640px) { .fso-grille { grid-template-columns: 1fr !important; } .fso-large { grid-column: auto !important; } }`}</style>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Fiche sécurité de l'opération"
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
          width: "min(760px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ width: 30, height: 30, borderRadius: RADIUS.md, flexShrink: 0, background: acc.bg10, color: acc.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={ShieldCheck} size={16}/>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: T.text }}>Fiche sécurité</div>
            <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{op.nom} · une fiche de préparation par chantier</div>
          </div>
          <button onClick={onClose} title="Fermer" style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}><Icon as={X} size={18}/></button>
        </div>

        <div style={{ padding: "14px 20px 18px", overflowY: "auto" }}>
          <BlocBatiment T={T} acc={acc} op={op} auteur={auteur}/>

          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 1, textTransform: "uppercase", margin: "4px 0 6px" }}>
            Chantiers
          </div>
          {etat.lecture === "erreur" && (
            <div style={{ fontSize: FONT.sm.size, color: "#e15a5a", fontWeight: 600, marginBottom: 8 }}>
              État des fiches illisible ({etat.erreur}) : on ne sait pas quels chantiers ont déjà une fiche.{" "}
              <button onClick={chargerFiches} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>Réessayer</button>
            </div>
          )}
          {justifs.erreur && (
            <div style={{ fontSize: FONT.xs.size + 1, color: "#b97a10", fontWeight: 600, marginBottom: 8 }}>
              Justificatifs illisibles ({justifs.erreur}) : les pastilles « justificatifs manquants / expiré » ne peuvent pas s'afficher.
            </div>
          )}
          {chantiersListes.length === 0 ? (
            <div style={{ fontSize: FONT.sm.size, color: T.textMuted, fontStyle: "italic" }}>Aucun chantier rattaché à cette opération.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {chantiersListes.map((c) => {
                const p = pastilleFicheSecurite({ chantier: c, fiche: etat.parChantier[c.id] || null, lecture: etat.lecture, justificatifs: justifs.parChantier[c.id] || null });
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c.couleur || "#888", flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nom}</div>
                      {p.detail && <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 2 }}>{p.detail}</div>}
                      {(() => {
                        // Tâche 7 : chantier déjà en cours sans fiche validée (pas de blocage rétroactif, écart visible).
                        const a = alerteChantierEnCours({ chantier: c, fiche: etat.parChantier[c.id] || null, lecture: etat.lecture });
                        return a ? <div style={{ fontSize: 10.5, color: "#e15a5a", fontWeight: 700, marginTop: 2 }}>{a}</div> : null;
                      })()}
                      {(() => {
                        const m = majProposees[c.id];
                        if (!m) return null;
                        if (m.erreur) return <div style={{ fontSize: 10.5, color: "#b97a10", fontWeight: 600, marginTop: 2 }}>Mise à jour proposée : non vérifiée ({m.erreur}).</div>;
                        return (
                          <>
                            {m.raisons.length > 0 && (
                              <div style={{ fontSize: 11, color: "#b97a10", fontWeight: 700, marginTop: 3 }}>
                                Mise à jour proposée : {m.raisons.map((x) => x.message).join(" ; ")}.{" "}
                                <button onClick={() => { setOuvrirEnMiseAJour(true); setFicheOuverte(c); }} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", fontSize: 11 }}>Mettre à jour</button>
                              </div>
                            )}
                            {m.impossibles.length > 0 && <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 2 }}>Non vérifié : {m.impossibles.join(" ; ")}.</div>}
                          </>
                        );
                      })()}
                    </div>
                    <Pastille p={p}/>
                    {etat.lecture === "ok" && etat.parChantier[c.id] ? (
                      <button onClick={() => setFicheOuverte(c)} style={boutonLigne(true)}>Ouvrir la fiche</button>
                    ) : peutCreerFiche({ chantier: c, fiche: etat.parChantier[c.id] || null, lecture: etat.lecture }) ? (
                      <button onClick={() => creer(c)} disabled={!!creation.chantierId} style={boutonLigne(!creation.chantierId)}>
                        {creation.chantierId === c.id ? "Création…" : "Créer la fiche"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {creation.erreur && (
            <div style={{ fontSize: FONT.sm.size, color: "#e15a5a", fontWeight: 600, marginTop: 8 }}>{creation.erreur}</div>
          )}
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 10, fontStyle: "italic" }}>
            Pas de fiche pour un chantier déjà terminé. Rouge : un justificatif requis manque ou un justificatif joint est expiré.
          </div>
        </div>
      </div>
    </div>
    {ficheOuverte && (
      <FicheSecuriteChantier T={T} acc={acc} op={op} chantier={ficheOuverte} profil={profil} onClose={fermerFiche} miseAJourDemandee={ouvrirEnMiseAJour}/>
    )}
    </>
  );
}
