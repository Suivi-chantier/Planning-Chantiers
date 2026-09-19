// src/AdresseAutocomplete.jsx — Champ d'adresse avec suggestions (Base Adresse Nationale).
//
// Un seul composant pour toute l'appli : on tape « 12 rue Paul », l'API Adresse
// de l'État propose « 12 Rue Paul Langevin 49240 Avrillé », et au clic le site
// appelant reçoit l'adresse découpée (rue, code postal, ville, coordonnées) pour
// remplir tous ses champs d'un coup.
//
//   <AdresseInput value={txt} onChange={setTxt} />                       // champ unique : le libellé complet est écrit
//   <AdresseInput value={rue} champ="rue" onSelect={s => setForm({...})}/> // champs séparés : le site remplit tout via onSelect
//   <AdresseInput type="commune" champ="ville" onSelect=... />            // champ Ville : suggère des communes (code postal inclus)
//   <AdresseInput type="commune" champ="cp" onSelect=... />               // champ Code postal : même chose depuis le code
//
// Règle : si `onSelect` est fourni, le composant N'appelle PAS `onChange` lors du
// choix d'une suggestion — c'est au site de mettre à jour tous ses champs (texte
// compris) en une seule fois. Sans `onSelect`, `onChange(texte)` reçoit le texte
// correspondant au mode `champ` (libellé complet par défaut).
//
// La liste est rendue dans un portail (document.body) : elle n'est jamais rognée
// par un conteneur overflow:hidden (modales, tableaux, cartes). Son style est lu
// sur le champ lui-même (couleur, bordure, police) et son fond est le premier fond
// OPAQUE trouvé en remontant (les champs de l'appli sont souvent translucides).
//
// Réactivité : les serveurs de l'État sont parfois lents (0,15 s à 10 s). Pour que
// la liste réagisse quand même à chaque frappe :
//   - les deux serveurs (api-adresse.data.gouv.fr et data.geopf.fr) sont interrogés
//     en parallèle, le premier qui répond gagne ;
//   - les résultats déjà reçus pour une saisie plus courte sont filtrés localement
//     et affichés tout de suite (grisés) en attendant la vraie réponse ;
//   - les réponses sont mises en cache pour la session ;
//   - une priorité géographique (Angers par défaut) fait remonter les adresses proches.
//
// API gratuite, sans clé, France uniquement ; hors de France (ex. Maroc) la saisie
// libre continue de fonctionner, simplement sans suggestion.

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// Serveur principal + repli (même format de réponse GeoJSON).
const SERVEURS_BAN = [
  "https://api-adresse.data.gouv.fr/search/",
  "https://data.geopf.fr/geocodage/search",
];

const cacheRecherches = new Map(); // clé → tableau de suggestions
const CACHE_MAX = 300;
const DELAI_MAX_MS = 8000;         // au-delà, on abandonne la requête

// Priorité géographique par défaut : Angers (siège Profero). Les adresses proches
// remontent en tête (« 12 rue Paul Lan… » → Avrillé avant Hirsingue). Passer
// `priorite={null}` au composant pour désactiver.
export const PRIORITE_GEO = { lat: 47.4784, lon: -0.5632 };

export function normaliserSaisie(texte) {
  return String(texte || "").replace(/\s+/g, " ").trim();
}
function cleCache(q, type, limit, priorite) {
  const geo = priorite && Number.isFinite(priorite.lat) ? `${priorite.lat.toFixed(2)},${priorite.lon.toFixed(2)}` : "-";
  return `${type}|${limit}|${geo}|${q.toLowerCase()}`;
}

/** Minuscules, sans accents, découpé en mots (pour le filtrage local). */
function motsDe(texte) {
  return String(texte || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter(Boolean);
}

/** Vrai si chaque mot tapé est le début d'un mot du libellé (« 12 rue paul lan » ↔ « 12 Rue Paul Langevin 49240 Avrillé »). */
export function correspondLocalement(suggestion, saisie) {
  const cibles = motsDe(`${suggestion.label} ${suggestion.contexte || ""}`);
  return motsDe(saisie).every(m => cibles.some(c => c.startsWith(m)));
}

/**
 * Aperçu instantané pendant que le serveur répond : on repart des résultats déjà
 * reçus pour une saisie plus courte (préfixe de la saisie actuelle) et on les
 * filtre localement. Retourne [] si rien d'exploitable.
 */
export function apercuDepuisCache(saisie, { type = "adresse", limit = 6, priorite = PRIORITE_GEO } = {}) {
  const q = normaliserSaisie(saisie).toLowerCase();
  if (q.length < 3) return [];
  const prefixe = cleCache("", type, limit, priorite); // "type|limit|geo|"
  let meilleur = null;
  for (const [cle, resultats] of cacheRecherches) {
    if (!cle.startsWith(prefixe)) continue;
    const qCache = cle.slice(prefixe.length);
    if (!q.startsWith(qCache) || !resultats.length) continue;
    if (!meilleur || qCache.length > meilleur.q.length) meilleur = { q: qCache, resultats };
  }
  if (!meilleur) return [];
  return meilleur.resultats.filter(s => correspondLocalement(s, q));
}

function memoriser(cle, valeur) {
  if (cacheRecherches.size >= CACHE_MAX) {
    const premiere = cacheRecherches.keys().next().value;
    cacheRecherches.delete(premiere);
  }
  cacheRecherches.set(cle, valeur);
}

/** Transforme une feature GeoJSON de l'API Adresse en objet plat, prêt pour les formulaires. */
export function formaterSuggestion(feature) {
  const p = feature?.properties || {};
  const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  const contexte = String(p.context || "");
  const morceaux = contexte.split(",").map(s => s.trim()).filter(Boolean);
  const estCommune = p.type === "municipality";
  const adresse = estCommune ? "" : String(p.name || "").trim();
  const codePostal = String(p.postcode || "").trim();
  const ville = String(p.city || "").trim();
  return {
    id: p.id || `${adresse}|${codePostal}|${ville}`,
    type: p.type || "",                 // housenumber | street | locality | municipality
    label: estCommune
      ? [ville, codePostal].filter(Boolean).join(" ")
      : (p.label || [adresse, codePostal, ville].filter(Boolean).join(" ")),
    adresse,                            // « 12 Rue Paul Langevin » (n° + voie, sans CP ni ville)
    numero: String(p.housenumber || "").trim(),
    rue: String(p.street || (estCommune ? "" : p.name) || "").trim(),
    codePostal,
    ville,
    codeInsee: String(p.citycode || "").trim(),
    departement: morceaux[1] || "",
    region: morceaux[2] || "",
    contexte,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    score: Number(p.score) || 0,
  };
}

/**
 * Interroge l'API Adresse. `type` : "adresse" (défaut) ou "commune".
 * Retourne un tableau de suggestions (voir formaterSuggestion). Lève une erreur
 * si les deux serveurs sont indisponibles.
 */
export async function rechercherAdresses(saisie, { type = "adresse", limit = 6, signal, priorite = PRIORITE_GEO } = {}) {
  const q = normaliserSaisie(saisie);
  if (q.length < 3) return [];
  const cle = cleCache(q, type, limit, priorite);
  if (cacheRecherches.has(cle)) return cacheRecherches.get(cle);

  const params = new URLSearchParams({ q: q.slice(0, 200), limit: String(limit), autocomplete: "1" });
  if (type === "commune") params.set("type", "municipality");
  // Priorité géographique : bonus de classement côté serveur autour du point donné
  // (pas un filtre : une ville tapée explicitement reste trouvée et bien classée).
  if (priorite && Number.isFinite(priorite.lat) && Number.isFinite(priorite.lon)) {
    params.set("lat", String(priorite.lat));
    params.set("lon", String(priorite.lon));
  }

  // Les deux serveurs sont interrogés en parallèle : le premier qui répond gagne,
  // l'autre est annulé (api-adresse.data.gouv.fr est parfois lent à plusieurs secondes).
  const controleurs = SERVEURS_BAN.map(() => new AbortController());
  const annulerTout = () => controleurs.forEach(c => { try { c.abort(); } catch {} });
  if (signal) {
    if (signal.aborted) throw Object.assign(new Error("Annulé"), { name: "AbortError" });
    signal.addEventListener("abort", annulerTout, { once: true });
  }
  const garde = setTimeout(annulerTout, DELAI_MAX_MS);

  const tentatives = SERVEURS_BAN.map(async (base, i) => {
    const rep = await fetch(`${base}?${params.toString()}`, { signal: controleurs[i].signal });
    if (!rep.ok) throw new Error(`API Adresse ${rep.status}`);
    const json = await rep.json();
    const features = Array.isArray(json?.features) ? json.features : [];
    return features.map(formaterSuggestion).filter(s => s.label);
  });

  try {
    const resultats = await Promise.any(tentatives);
    memoriser(cle, resultats);
    return resultats;
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error("Annulé"), { name: "AbortError" });
    const causes = e?.errors || [e];
    throw causes.find(c => c?.name !== "AbortError") || new Error("API Adresse indisponible");
  } finally {
    clearTimeout(garde);
    annulerTout();
    if (signal) signal.removeEventListener("abort", annulerTout);
  }
}

/** Texte à écrire dans le champ selon le mode. */
export function texteSelection(s, champ) {
  if (!s) return "";
  if (champ === "rue") return s.adresse || s.label;
  if (champ === "ville") return s.ville || s.label;
  if (champ === "cp") return s.codePostal || "";
  return s.label;
}

/** Décompose une couleur CSS calculée (rgb / rgba) ; null si illisible. */
function lireCouleur(couleur) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(String(couleur || "").trim())
    || /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(String(couleur || "").trim());
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (String(m[4] || "").endsWith("%")) a = a / 100;
  return { r: +m[1], g: +m[2], b: +m[3], a: Number.isFinite(a) ? a : 1 };
}

// Les champs de l'appli ont souvent un fond translucide (rgba(0,0,0,0.03)…) :
// il faut un fond réellement opaque pour la liste, sinon le formulaire se voit au travers.
function estOpaque(couleur) {
  const c = lireCouleur(couleur);
  return !!c && c.a >= 0.98;
}

function estClair(couleur) {
  const c = lireCouleur(couleur);
  if (!c) return true;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 140;
}

/** Lit le style du champ pour que la liste suive le thème (clair / sombre, mono, etc.). */
function styleDepuisChamp(el) {
  const defaut = { fond: "#ffffff", texte: "#1c1c1c", bordure: "rgba(0,0,0,0.18)", police: "inherit", taille: "14px" };
  if (!el || typeof window === "undefined") return defaut;
  try {
    const cs = window.getComputedStyle(el);
    const texte = cs.color || defaut.texte;
    // Remonte jusqu'au premier fond opaque (carte, modale, page).
    let fond = null;
    let noeud = el;
    while (noeud && noeud !== document.documentElement) {
      const bg = window.getComputedStyle(noeud).backgroundColor;
      if (estOpaque(bg)) { fond = bg; break; }
      noeud = noeud.parentElement;
    }
    // Aucun fond opaque trouvé : on déduit du contraste du texte (texte clair → fond sombre).
    if (!fond) fond = estClair(texte) ? "#1f232b" : defaut.fond;
    const bordure = lireCouleur(cs.borderColor);
    return {
      fond,
      texte,
      bordure: bordure && bordure.a > 0.05 ? cs.borderColor : (estClair(texte) ? "rgba(255,255,255,0.18)" : defaut.bordure),
      police: cs.fontFamily || defaut.police,
      taille: cs.fontSize || defaut.taille,
    };
  } catch { return defaut; }
}

const DELAI_SAISIE_MS = 150;

export default function AdresseInput({
  value,
  onChange,
  onSelect,
  type = "adresse",          // "adresse" | "commune"
  champ = "complet",         // "complet" | "rue" | "ville" | "cp"
  multiline = false,
  wrapperStyle,
  style,
  className,
  placeholder,
  minChars = 3,
  limit = 6,
  priorite = PRIORITE_GEO, // { lat, lon } pour classer les adresses proches en tête ; null pour désactiver
  disabled,
  readOnly,
  onKeyDown: onKeyDownExt,
  onBlur: onBlurExt,
  onFocus: onFocusExt,
  ...reste
}) {
  const inputRef = useRef(null);
  const listeRef = useRef(null);
  const timerRef = useRef(null);
  const fermetureRef = useRef(null);
  const derniereRequeteRef = useRef("");

  const [ouvert, setOuvert] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [actif, setActif] = useState(-1);
  const [chargement, setChargement] = useState(false);
  const [position, setPosition] = useState(null);
  const [theme, setTheme] = useState(null);

  // Requêtes en vol : on ne les annule PAS quand la saisie continue. Une réponse
  // pour « 12 rue paul » sert d'aperçu filtré pour « 12 rue paul lan » et
  // alimente le cache ; seule la fermeture du composant les abandonne.
  const enVolRef = useRef(new Set());

  const annulerTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const annulerRecherche = useCallback(() => {
    annulerTimer();
    enVolRef.current.forEach(c => { try { c.abort(); } catch {} });
    enVolRef.current.clear();
  }, [annulerTimer]);

  const fermer = useCallback(() => {
    annulerTimer();
    setOuvert(false);
    setActif(-1);
  }, [annulerTimer]);

  const calculerPosition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hauteurListe = Math.min(280, 44 * Math.max(1, suggestions.length) + 8);
    const placeDessous = window.innerHeight - r.bottom;
    const enHaut = placeDessous < hauteurListe && r.top > placeDessous;
    setPosition({
      left: Math.max(4, Math.min(r.left, window.innerWidth - 300)),
      width: Math.max(r.width, 280),
      top: enHaut ? null : r.bottom + 4,
      bottom: enHaut ? (window.innerHeight - r.top + 4) : null,
    });
  }, [suggestions.length]);

  const aLeFocus = () => typeof document !== "undefined" && document.activeElement === inputRef.current;

  // Applique des résultats reçus pour la saisie `q` (réponse serveur ou aperçu local).
  const appliquerResultats = useCallback((q, res, { definitif }) => {
    const courant = derniereRequeteRef.current;
    if (definitif && q === courant) {
      setSuggestions(res);
      setActif(-1);
      setOuvert(res.length > 0 && aLeFocus());
      setChargement(false);
      return;
    }
    // Réponse d'une saisie plus courte (préfixe de la saisie actuelle) : aperçu filtré
    // en attendant la vraie réponse, sauf si celle-ci est déjà arrivée.
    if (courant.toLowerCase().startsWith(q.toLowerCase()) && !cacheRecherches.has(cleCache(courant, type, limit, priorite))) {
      const filtres = res.filter(s => correspondLocalement(s, courant));
      if (filtres.length) { setSuggestions(filtres); setActif(-1); if (aLeFocus()) setOuvert(true); }
    }
  }, [type, limit, priorite]);

  const lancerRequete = useCallback(async (q) => {
    const controleur = new AbortController();
    enVolRef.current.add(controleur);
    try {
      const res = await rechercherAdresses(q, { type, limit, priorite, signal: controleur.signal });
      if (controleur.signal.aborted) return;
      appliquerResultats(q, res, { definitif: true });
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.warn("[AdresseInput] API Adresse indisponible :", e?.message || e);
      if (derniereRequeteRef.current === q) { setChargement(false); if (!suggestions.length) setOuvert(false); }
    } finally {
      enVolRef.current.delete(controleur);
    }
  }, [type, limit, priorite, appliquerResultats, suggestions.length]);

  // À chaque frappe : aperçu instantané depuis le cache, puis requête après une courte pause.
  const programmerRecherche = useCallback((texte) => {
    annulerTimer();
    const q = normaliserSaisie(texte);
    derniereRequeteRef.current = q;
    if (q.length < minChars) { setSuggestions([]); setOuvert(false); setChargement(false); return; }

    const cle = cleCache(q, type, limit, priorite);
    if (cacheRecherches.has(cle)) { appliquerResultats(q, cacheRecherches.get(cle), { definitif: true }); return; }

    const apercu = apercuDepuisCache(q, { type, limit, priorite });
    if (apercu.length) { setSuggestions(apercu); setActif(-1); if (aLeFocus()) setOuvert(true); }
    setChargement(true);
    if (aLeFocus()) setOuvert(true); // ligne « Recherche… » : on voit que ça travaille

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (derniereRequeteRef.current === q) lancerRequete(q);
    }, DELAI_SAISIE_MS);
  }, [annulerTimer, minChars, type, limit, priorite, appliquerResultats, lancerRequete]);

  useEffect(() => () => annulerRecherche(), [annulerRecherche]);

  // Position + thème quand la liste s'ouvre ; suit le défilement et le redimensionnement.
  useEffect(() => {
    if (!ouvert) return;
    setTheme(styleDepuisChamp(inputRef.current));
    calculerPosition();
    const maj = () => calculerPosition();
    window.addEventListener("scroll", maj, true);
    window.addEventListener("resize", maj);
    return () => {
      window.removeEventListener("scroll", maj, true);
      window.removeEventListener("resize", maj);
    };
  }, [ouvert, calculerPosition]);

  // Garde l'élément actif visible dans la liste.
  useEffect(() => {
    if (!ouvert || actif < 0 || !listeRef.current) return;
    const el = listeRef.current.children[actif];
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [actif, ouvert]);

  const choisir = useCallback((s) => {
    if (!s) return;
    fermer();
    const texte = texteSelection(s, champ);
    if (typeof onSelect === "function") onSelect(s, texte);
    else if (typeof onChange === "function") onChange(texte);
    // Le focus reste sur le champ pour enchaîner la saisie (Tab vers le suivant).
    requestAnimationFrame(() => { try { inputRef.current?.focus(); } catch {} });
  }, [champ, fermer, onSelect, onChange]);

  const surSaisie = (e) => {
    const texte = e.target.value;
    if (typeof onChange === "function") onChange(texte);
    programmerRecherche(texte);
  };

  const surClavier = (e) => {
    if (ouvert && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActif(i => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActif(i => (i <= 0 ? suggestions.length - 1 : i - 1)); return; }
      if (e.key === "Enter" && actif >= 0) { e.preventDefault(); choisir(suggestions[actif]); return; }
      if (e.key === "Escape") { e.preventDefault(); fermer(); return; }
      if (e.key === "Tab") { fermer(); }
    } else if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault(); setOuvert(true); setActif(0); return;
    }
    if (typeof onKeyDownExt === "function") onKeyDownExt(e);
  };

  const surFocus = (e) => {
    if (suggestions.length > 0 && String(value || "").trim().length >= minChars) setOuvert(true);
    if (typeof onFocusExt === "function") onFocusExt(e);
  };

  const surBlur = (e) => {
    // Petit délai : un clic sur une suggestion (mousedown → preventDefault) ne provoque
    // pas de blur, mais on couvre les navigateurs qui le déclenchent quand même.
    fermetureRef.current = setTimeout(() => setOuvert(false), 120);
    if (typeof onBlurExt === "function") onBlurExt(e);
  };
  useEffect(() => () => { if (fermetureRef.current) clearTimeout(fermetureRef.current); }, []);

  const Balise = multiline ? "textarea" : "input";
  const styleChamp = { width: "100%", boxSizing: "border-box", textAlign: "left", ...(style || {}) };

  const liste = ouvert && position && (suggestions.length > 0 || chargement) && typeof document !== "undefined" ? createPortal(
    <div
      ref={listeRef}
      role="listbox"
      onMouseDown={e => e.preventDefault()} // ne pas voler le focus au champ
      style={{
        position: "fixed",
        left: position.left,
        width: position.width,
        top: position.top ?? "auto",
        bottom: position.bottom ?? "auto",
        maxHeight: 280,
        overflowY: "auto",
        zIndex: 100000,
        background: theme?.fond || "#fff",
        color: theme?.texte || "#1c1c1c",
        border: `1px solid ${theme?.bordure || "rgba(0,0,0,0.18)"}`,
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        fontFamily: theme?.police || "inherit",
        fontSize: theme?.taille || 14,
        padding: 4,
      }}
    >
      {suggestions.map((s, i) => {
        const estActif = i === actif;
        return (
          <div
            key={s.id || i}
            role="option"
            aria-selected={estActif}
            onMouseEnter={() => setActif(i)}
            onClick={() => choisir(s)}
            style={{
              padding: "7px 10px",
              borderRadius: 7,
              cursor: "pointer",
              background: estActif ? "rgba(127,127,127,0.20)" : "transparent",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              lineHeight: 1.3,
              opacity: chargement ? 0.55 : 1, // anciens résultats grisés pendant la nouvelle recherche
              transition: "opacity .12s",
            }}
          >
            <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
            {(s.departement || s.contexte) && (
              <span style={{ fontSize: "0.82em", opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.type === "municipality" ? (s.departement || s.contexte) : (s.departement ? `${s.departement}${s.region ? " · " + s.region : ""}` : s.contexte)}
              </span>
            )}
          </div>
        );
      })}
      {chargement && (
        <div aria-live="polite" style={{ padding: "6px 10px", fontSize: "0.85em", opacity: 0.6, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", flex: "0 0 auto",
            border: "2px solid currentColor", borderRightColor: "transparent",
            animation: "adresse-rotation .8s linear infinite",
          }}/>
          Recherche…
          <style>{"@keyframes adresse-rotation{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div style={{ position: "relative", display: "block", minWidth: 0, ...(wrapperStyle || {}) }}>
      <Balise
        ref={inputRef}
        type={multiline ? undefined : "text"}
        className={className}
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onChange={surSaisie}
        onKeyDown={surClavier}
        onFocus={surFocus}
        onBlur={surBlur}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={ouvert}
        aria-busy={chargement || undefined}
        style={styleChamp}
        {...reste}
      />
      {liste}
    </div>
  );
}
