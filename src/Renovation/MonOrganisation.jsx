// src/Renovation/MonOrganisation.jsx — Section « Mon organisation » du panneau
// « Mon profil » (projet docs/projets/organisation-par-jour.md, étape 3).
//
// Pour chaque jour du lundi au vendredi : thématique, page d'arrivée, pages en
// tête (ordonnées), rendez-vous fixes et blocs du tableau de bord (ordonnés).
// Ce n'est PAS une page du menu : rien dans src/access.js, aucun droit changé.
// Seules les pages du menu déjà autorisées pour le rôle sont proposées
// (idsPagesDuMenu : configuration en base + ajout automatique admin).
//
// Enregistrement : aucune nouvelle écriture vers `utilisateurs`. L'écran passe
// par enregistrerNavOrder du hook useNavOrder (Navigation.jsx), c'est-à-dire
// les deux écritures existantes de `nav_order` ; les barres de navigation se
// mettent à jour aussitôt (même événement que le glisser-déposer).
// Calculs (normalisation, modèle, suppression) : module pur organisationJour.mjs.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, X, Plus, CalendarRange, Wand2, Save, Trash2, Undo2 } from "lucide-react";
import { Icon } from "../ui";
import { useIsMobile, useDirtyGuard } from "../hooks";
import { useNavOrder, idsPagesDuMenu, LABELS_PAGES } from "./Navigation";
import {
  JOURS_ORGANISATION, CATALOGUE_BLOCS, LIBELLES_BLOCS, lireNavOrder, normaliserJours,
  ecrireJours, supprimerOrganisation, filtrerPagesAutorisees, copieModeleConducteurTravaux,
} from "./organisationJour.js";

const NOMS_JOURS = { lundi: "Lundi", mardi: "Mardi", mercredi: "Mercredi", jeudi: "Jeudi", vendredi: "Vendredi" };
const COURTS_JOURS = { lundi: "Lun", mardi: "Mar", mercredi: "Mer", jeudi: "Jeu", vendredi: "Ven" };

const jourVideFormulaire = () => ({ theme: "", accueil: "", devant: [], rendez_vous: [], blocs: [] });

/** Formulaire complet (5 jours) à partir d'un objet `jours` déjà lu. */
function formulaireDepuisJours(jours) {
  const f = {};
  for (const j of JOURS_ORGANISATION) {
    const c = jours?.[j];
    f[j] = !c ? jourVideFormulaire() : {
      theme: c.theme || "",
      accueil: c.accueil || "",
      devant: Array.isArray(c.devant) ? c.devant.slice() : [],
      rendez_vous: Array.isArray(c.rendez_vous) ? c.rendez_vous.map((r) => ({ heure: r.heure || "", libelle: r.libelle || "" })) : [],
      blocs: Array.isArray(c.blocs) ? c.blocs.slice() : [],
    };
  }
  return f;
}

const empreinte = (form) => JSON.stringify(normaliserJours(form));
const libellePage = (id) => LABELS_PAGES[id] || id;

function phraseRetirees(retirees) {
  return retirees.map((r) => `${NOMS_JOURS[r.jour]} : ${libellePage(r.id)}${r.champ === "accueil" ? " (page d'arrivée)" : ""}`).join(" ; ");
}

const styleChamp = (T) => ({
  width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || "transparent",
  color: T.text, fontSize: 14, fontFamily: "inherit", minHeight: 40,
});
const styleBouton = (T, couleur, desactive) => ({
  display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center",
  padding: "9px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: "inherit",
  cursor: desactive ? "default" : "pointer", border: `1px solid ${couleur}`,
  background: desactive ? "transparent" : `${couleur}1a`, color: desactive ? T.textMuted : couleur,
  opacity: desactive ? 0.6 : 1, minHeight: 40,
});
const styleIcone = (T, desactive) => ({
  background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: 5,
  display: "inline-flex", cursor: desactive ? "default" : "pointer", color: desactive ? T.textMuted : T.textSub,
  opacity: desactive ? 0.4 : 1, minWidth: 30, minHeight: 30, alignItems: "center", justifyContent: "center",
});

function Libelle({ T, children, aide }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: .4, textTransform: "uppercase", color: T.textSub }}>{children}</span>
      {aide && <span style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.4 }}>{aide}</span>}
    </div>
  );
}

/** Choix multiple ordonné : liste numérotée, flèches haut / bas, retrait, ajout. */
function ListeOrdonnee({ T, valeurs, options, onChange, libelleAjout, nomListe }) {
  const libelles = Object.fromEntries(options.map((o) => [o.id, o.label]));
  const restantes = options.filter((o) => !valeurs.includes(o.id));
  const deplacer = (i, d) => {
    const v = valeurs.slice();
    const j = i + d;
    if (j < 0 || j >= v.length) return;
    [v[i], v[j]] = [v[j], v[i]];
    onChange(v);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {valeurs.length === 0 ? (
        <div style={{ fontSize: 13, color: T.textMuted, border: `1px dashed ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>Aucune</div>
      ) : (
        <ol aria-label={nomListe} style={{ margin: 0, padding: 0, listStyle: "none", border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          {valeurs.map((id, i) => (
            <li key={id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderTop: i ? `1px solid ${T.border}` : "none" }}>
              <span style={{ width: 18, fontSize: 12, fontWeight: 700, color: T.textMuted, textAlign: "right" }}>{i + 1}.</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: T.text }}>{libelles[id] || id}</span>
              <button type="button" aria-label={`Monter ${libelles[id] || id}`} title="Monter" disabled={i === 0} onClick={() => deplacer(i, -1)} style={styleIcone(T, i === 0)}><Icon as={ArrowUp} size={15}/></button>
              <button type="button" aria-label={`Descendre ${libelles[id] || id}`} title="Descendre" disabled={i === valeurs.length - 1} onClick={() => deplacer(i, 1)} style={styleIcone(T, i === valeurs.length - 1)}><Icon as={ArrowDown} size={15}/></button>
              <button type="button" aria-label={`Retirer ${libelles[id] || id}`} title="Retirer" onClick={() => onChange(valeurs.filter((x) => x !== id))} style={styleIcone(T, false)}><Icon as={X} size={15}/></button>
            </li>
          ))}
        </ol>
      )}
      {restantes.length > 0 && (
        <select aria-label={libelleAjout} value="" onChange={(e) => { if (e.target.value) onChange([...valeurs, e.target.value]); }} style={styleChamp(T)}>
          <option value="">{libelleAjout}</option>
          {restantes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * Section « Mon organisation ». `onModifie(bool)` prévient le panneau qu'il y a
 * des modifications non enregistrées (confirmation avant fermeture).
 */
export default function MonOrganisation({ profil, role, rolePages = null, T, onModifie = null }) {
  const mobile = useIsMobile();
  const [navOrder, , , enregistrerNavOrder] = useNavOrder(profil);
  const pages = useMemo(() => idsPagesDuMenu(role, rolePages), [role, rolePages]);
  const optionsPages = useMemo(() => pages.map((id) => ({ id, label: libellePage(id) })), [pages]);
  const optionsBlocs = useMemo(() => CATALOGUE_BLOCS.map((id) => ({ id, label: LIBELLES_BLOCS[id] || id })), []);

  // Organisation enregistrée, réduite aux pages autorisées pour le rôle (règle 2).
  const enregistree = useMemo(() => filtrerPagesAutorisees(lireNavOrder(navOrder).jours, pages), [navOrder, pages]);
  const aOrganisation = lireNavOrder(navOrder).aOrganisation;

  const [form, setForm] = useState(() => formulaireDepuisJours(enregistree.jours));
  const base = useRef(empreinte(formulaireDepuisJours(enregistree.jours)));
  const [jour, setJour] = useState("lundi");
  const [message, setMessage] = useState(null);      // { ton: "info"|"ok"|"erreur", texte }
  const [enCours, setEnCours] = useState(false);
  const modifie = empreinte(form) !== base.current;

  // Valeur enregistrée relue (autre appareil, autre barre, rôle chargé) : on
  // recharge le formulaire seulement s'il n'y a pas de saisie en cours.
  const cleEnregistree = JSON.stringify([enregistree.jours, pages]);
  useEffect(() => {
    if (modifie) return;
    base.current = empreinte(formulaireDepuisJours(enregistree.jours));
    setForm(formulaireDepuisJours(enregistree.jours));
  }, [cleEnregistree]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onModifie?.(modifie); }, [modifie]);   // eslint-disable-line react-hooks/exhaustive-deps
  useDirtyGuard("mon-organisation", modifie);

  const majJour = (champ, valeur) => setForm((f) => ({ ...f, [jour]: { ...f[jour], [champ]: valeur } }));
  const conf = form[jour];
  const jourRempli = (j) => !!normaliserJours({ [j]: form[j] })[j];

  const appliquerModele = () => {
    if (Object.keys(normaliserJours(form)).length > 0
      && !window.confirm("Remplacer le contenu du formulaire par le modèle « Conducteur de travaux » ? Rien n'est enregistré tant que vous ne cliquez pas sur « Enregistrer ».")) return;
    const { jours, retirees } = filtrerPagesAutorisees(copieModeleConducteurTravaux(), pages);
    setForm(formulaireDepuisJours(jours));
    setJour("lundi");
    setMessage({
      ton: "info",
      texte: "Modèle « Conducteur de travaux » appliqué au formulaire, rien n'est encore enregistré : relisez chaque jour, ajustez si besoin, puis cliquez sur « Enregistrer »."
        + (retirees.length ? ` Pages du modèle retirées car non autorisées pour votre rôle : ${phraseRetirees(retirees)}.` : ""),
    });
  };

  const enregistrer = async () => {
    const valeur = ecrireJours(navOrder, form);
    setEnCours(true);
    setMessage(null);
    const { error } = await enregistrerNavOrder(valeur);
    setEnCours(false);
    if (error) {
      setMessage({ ton: "erreur", texte: `Organisation non enregistrée : ${error.message || "erreur inconnue"}. Vos saisies sont toujours là ; réessayez.` });
      return;
    }
    const n = Object.keys(normaliserJours(form)).length;
    base.current = empreinte(form);
    setMessage({ ton: "ok", texte: n
      ? `Organisation enregistrée (${n} jour${n > 1 ? "s" : ""} réglé${n > 1 ? "s" : ""}). Le menu suit déjà l'organisation du jour, sur ordinateur comme sur téléphone.`
      : "Aucun jour n'est rempli : l'application garde son fonctionnement habituel." });
  };

  const supprimer = async () => {
    if (!window.confirm("Supprimer votre organisation de la semaine ? Le menu et la page d'ouverture reviennent à votre fonctionnement habituel (votre ordre des onglets est conservé).")) return;
    setEnCours(true);
    setMessage(null);
    const { error } = await enregistrerNavOrder(supprimerOrganisation(navOrder));
    setEnCours(false);
    if (error) {
      setMessage({ ton: "erreur", texte: `Organisation non supprimée : ${error.message || "erreur inconnue"}. Réessayez.` });
      return;
    }
    const vide = formulaireDepuisJours({});
    base.current = empreinte(vide);
    setForm(vide);
    setMessage({ ton: "ok", texte: "Organisation supprimée : l'application a retrouvé son fonctionnement habituel." });
  };

  const annuler = () => {
    setForm(formulaireDepuisJours(enregistree.jours));
    setMessage(null);
  };

  const couleurMessage = { info: T.accent, ok: "#22c55e", erreur: "#ef4444" };

  return (
    <section aria-label="Mon organisation" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon as={CalendarRange} size={18} color={T.accent}/>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.text }}>Mon organisation de la semaine</h3>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: T.textSub }}>
        Pour chaque jour, les pages choisies passent en tête du menu (ordinateur et téléphone) et l'application s'ouvre
        sur la page d'arrivée. Un jour laissé vide garde le menu habituel ; samedi et dimanche aussi.
        La thématique et les rendez-vous s'afficheront en haut du tableau de bord lors d'une prochaine mise à jour.
      </p>
      <div role="status" style={{ fontSize: 13, color: T.textSub, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
        {aOrganisation
          ? <>Organisation enregistrée : {Object.keys(lireNavOrder(navOrder).jours).map((j) => NOMS_JOURS[j]).join(", ")}.</>
          : <>Aucune organisation enregistrée : l'application garde son fonctionnement habituel.</>}
        {modifie && <strong style={{ color: T.accent }}> Modifications non enregistrées.</strong>}
        {enregistree.retirees.length > 0 && (
          <div style={{ marginTop: 4 }}>Pages enregistrées non autorisées pour votre rôle, ignorées : {phraseRetirees(enregistree.retirees)}.</div>
        )}
      </div>

      <div>
        <button type="button" onClick={appliquerModele} disabled={enCours} style={styleBouton(T, T.accent, enCours)}>
          <Icon as={Wand2} size={15}/> Appliquer le modèle Conducteur de travaux
        </button>
      </div>

      {message && (
        <div role={message.ton === "erreur" ? "alert" : "status"} style={{
          borderLeft: `3px solid ${couleurMessage[message.ton]}`, padding: "8px 10px", fontSize: 13, lineHeight: 1.5,
          color: T.text, background: `${couleurMessage[message.ton]}1a`, borderRadius: 4,
        }}>{message.texte}</div>
      )}

      {/* Choix du jour */}
      <div role="tablist" aria-label="Jour" style={{ display: "flex", gap: 4 }}>
        {JOURS_ORGANISATION.map((j) => {
          const actif = j === jour;
          return (
            <button key={j} type="button" role="tab" aria-selected={actif} onClick={() => setJour(j)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: actif ? 700 : 500,
              cursor: "pointer", border: `1px solid ${actif ? T.accent : T.border}`,
              background: actif ? `${T.accent}22` : "transparent", color: actif ? T.text : T.textSub,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 40,
            }}>
              {mobile ? COURTS_JOURS[j] : NOMS_JOURS[j]}
              {jourRempli(j) && <span aria-label="réglé" style={{ width: 7, height: 7, borderRadius: 4, background: "#22c55e" }}/>}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{NOMS_JOURS[jour]}</strong>
          {jourRempli(jour)
            ? <button type="button" onClick={() => setForm((f) => ({ ...f, [jour]: jourVideFormulaire() }))} style={styleBouton(T, T.textSub, false)}>Vider ce jour</button>
            : <span style={{ fontSize: 12, color: T.textMuted }}>Pas d'organisation ce jour-là</span>}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Libelle T={T}>Thématique</Libelle>
          <input type="text" value={conf.theme} maxLength={120} placeholder="Ex. : bilan, réunion et commandes"
            onChange={(e) => majJour("theme", e.target.value)} style={styleChamp(T)}/>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Libelle T={T} aide="Ouverte au démarrage de l'application, jamais pendant la navigation.">Page d'arrivée</Libelle>
          <select value={conf.accueil} onChange={(e) => majJour("accueil", e.target.value)} style={styleChamp(T)}>
            <option value="">Aucune (comme d'habitude)</option>
            {optionsPages.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Libelle T={T} aide="Remontent en tête du menu dans cet ordre ; les autres pages gardent l'ordre habituel.">Pages en tête</Libelle>
          <ListeOrdonnee T={T} valeurs={conf.devant} options={optionsPages} nomListe="Pages en tête"
            onChange={(v) => majJour("devant", v)} libelleAjout="Ajouter une page en tête…"/>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Libelle T={T} aide="Heure facultative. Un rendez-vous sans libellé n'est pas enregistré.">Rendez-vous fixes</Libelle>
          {conf.rendez_vous.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="time" aria-label={`Heure du rendez-vous ${i + 1}`} value={r.heure}
                onChange={(e) => majJour("rendez_vous", conf.rendez_vous.map((x, k) => k === i ? { ...x, heure: e.target.value } : x))}
                style={{ ...styleChamp(T), width: mobile ? 96 : 120, flex: "none" }}/>
              <input type="text" aria-label={`Libellé du rendez-vous ${i + 1}`} value={r.libelle} maxLength={160} placeholder="Libellé"
                onChange={(e) => majJour("rendez_vous", conf.rendez_vous.map((x, k) => k === i ? { ...x, libelle: e.target.value } : x))}
                style={{ ...styleChamp(T), flex: 1, minWidth: 0 }}/>
              <button type="button" aria-label={`Supprimer le rendez-vous ${i + 1}`} title="Supprimer"
                onClick={() => majJour("rendez_vous", conf.rendez_vous.filter((_, k) => k !== i))} style={styleIcone(T, false)}><Icon as={X} size={15}/></button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => majJour("rendez_vous", [...conf.rendez_vous, { heure: "", libelle: "" }])} style={styleBouton(T, T.textSub, false)}>
              <Icon as={Plus} size={15}/> Ajouter un rendez-vous
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Libelle T={T} aide="Affichés en premier sur le tableau de bord, dans cet ordre.">Blocs du tableau de bord</Libelle>
          <ListeOrdonnee T={T} valeurs={conf.blocs} options={optionsBlocs} nomListe="Blocs du tableau de bord"
            onChange={(v) => majJour("blocs", v)} libelleAjout="Ajouter un bloc…"/>
          <span style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.4 }}>
            Le contenu de ces blocs apparaîtra sur le tableau de bord lors d'une prochaine mise à jour ; une fois enregistré, votre choix est conservé d'ici là.
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={enregistrer} disabled={!modifie || enCours} style={styleBouton(T, "#22c55e", !modifie || enCours)}>
          <Icon as={Save} size={15}/> {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
        {modifie && (
          <button type="button" onClick={annuler} disabled={enCours} style={styleBouton(T, T.textSub, enCours)}>
            <Icon as={Undo2} size={15}/> Annuler les modifications
          </button>
        )}
        {aOrganisation && (
          <button type="button" onClick={supprimer} disabled={enCours} style={styleBouton(T, "#ef4444", enCours)}>
            <Icon as={Trash2} size={15}/> Supprimer mon organisation
          </button>
        )}
      </div>
    </section>
  );
}
