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
// sur le champ lui-même (fond, couleur, bordure, police) pour suivre le thème.
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
export async function rechercherAdresses(saisie, { type = "adresse", limit = 6, signal } = {}) {
  const q = String(saisie || "").replace(/\s+/g, " ").trim();
  if (q.length < 3) return [];
  const cle = `${type}|${limit}|${q.toLowerCase()}`;
  if (cacheRecherches.has(cle)) return cacheRecherches.get(cle);

  const params = new URLSearchParams({ q: q.slice(0, 200), limit: String(limit), autocomplete: "1" });
  if (type === "commune") params.set("type", "municipality");

  let derniereErreur = null;
  for (const base of SERVEURS_BAN) {
    try {
      const rep = await fetch(`${base}?${params.toString()}`, { signal });
      if (!rep.ok) { derniereErreur = new Error(`API Adresse ${rep.status}`); continue; }
      const json = await rep.json();
      const features = Array.isArray(json?.features) ? json.features : [];
      const resultats = features.map(formaterSuggestion).filter(s => s.label);
      memoriser(cle, resultats);
      return resultats;
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      derniereErreur = e;
    }
  }
  throw derniereErreur || new Error("API Adresse indisponible");
}

/** Texte à écrire dans le champ selon le mode. */
export function texteSelection(s, champ) {
  if (!s) return "";
  if (champ === "rue") return s.adresse || s.label;
  if (champ === "ville") return s.ville || s.label;
  if (champ === "cp") return s.codePostal || "";
  return s.label;
}

function estTransparent(couleur) {
  if (!couleur) return true;
  const c = couleur.replace(/\s+/g, "").toLowerCase();
  return c === "transparent" || /^rgba\(\d+,\d+,\d+,0\)$/.test(c) || c === "rgba(0,0,0,0)";
}

/** Lit le style du champ pour que la liste suive le thème (clair / sombre, mono, etc.). */
function styleDepuisChamp(el) {
  const defaut = { fond: "#ffffff", texte: "#1c1c1c", bordure: "rgba(0,0,0,0.18)", police: "inherit", taille: "14px" };
  if (!el || typeof window === "undefined") return defaut;
  try {
    const cs = window.getComputedStyle(el);
    let fond = cs.backgroundColor;
    if (estTransparent(fond)) {
      // Remonte jusqu'à trouver un fond opaque (carte, modale, page).
      let parent = el.parentElement;
      while (parent && estTransparent(fond)) { fond = window.getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
      if (estTransparent(fond)) fond = defaut.fond;
    }
    return {
      fond,
      texte: cs.color || defaut.texte,
      bordure: !estTransparent(cs.borderColor) && cs.borderColor ? cs.borderColor : defaut.bordure,
      police: cs.fontFamily || defaut.police,
      taille: cs.fontSize || defaut.taille,
    };
  } catch { return defaut; }
}

const DELAI_SAISIE_MS = 220;

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
  const abortRef = useRef(null);
  const fermetureRef = useRef(null);
  const derniereRequeteRef = useRef("");

  const [ouvert, setOuvert] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [actif, setActif] = useState(-1);
  const [chargement, setChargement] = useState(false);
  const [position, setPosition] = useState(null);
  const [theme, setTheme] = useState(null);

  const annulerRecherche = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
  }, []);

  const fermer = useCallback(() => {
    annulerRecherche();
    setOuvert(false);
    setActif(-1);
    setChargement(false);
  }, [annulerRecherche]);

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

  // Lance la recherche après une courte pause de frappe.
  const programmerRecherche = useCallback((texte) => {
    annulerRecherche();
    const q = String(texte || "").trim();
    if (q.length < minChars) { setSuggestions([]); setOuvert(false); setChargement(false); return; }
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      const controleur = new AbortController();
      abortRef.current = controleur;
      derniereRequeteRef.current = q;
      setChargement(true);
      try {
        const res = await rechercherAdresses(q, { type, limit, signal: controleur.signal });
        if (controleur.signal.aborted || derniereRequeteRef.current !== q) return;
        setSuggestions(res);
        setActif(-1);
        setOuvert(res.length > 0 && document.activeElement === inputRef.current);
      } catch (e) {
        if (e?.name !== "AbortError") {
          console.warn("[AdresseInput] API Adresse indisponible :", e?.message || e);
          setSuggestions([]);
          setOuvert(false);
        }
      } finally {
        if (abortRef.current === controleur) abortRef.current = null;
        if (derniereRequeteRef.current === q) setChargement(false);
      }
    }, DELAI_SAISIE_MS);
  }, [annulerRecherche, minChars, type, limit]);

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

  const liste = ouvert && position && suggestions.length > 0 && typeof document !== "undefined" ? createPortal(
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
