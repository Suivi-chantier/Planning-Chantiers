import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";

const STATUS_LABELS = {
  nouveau: "Nouveau",
  a_analyser: "À analyser",
  interessant: "Intéressant",
  a_contacter: "À contacter",
  contacte: "Contacté",
  visite_a_prevoir: "Visite à prévoir",
  offre_envisageable: "Offre envisageable",
  transforme_en_bien: "Transformé en bien",
  non_retenu: "Non retenu",
  archive: "Archivé",
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

const POSITIVE_KEYWORDS = [
  "immeuble",
  "à rénover",
  "a renover",
  "travaux",
  "fort potentiel",
  "division possible",
  "plusieurs logements",
  "plateau",
  "grenier",
  "combles",
  "dépendance",
  "dependance",
  "garage",
  "local commercial",
  "dpe f",
  "dpe g",
  "passoire énergétique",
  "passoire energetique",
  "investisseur",
  "rentabilité",
  "rentabilite",
  "colocation",
  "coliving",
  "déficit foncier",
  "deficit foncier",
  "ancien",
  "grande maison",
  "maison familiale",
];

const NEGATIVE_KEYWORDS = [
  "viager",
  "terrain seul",
  "mobil-home",
  "mobil home",
  "camping",
  "résidence services",
  "residence services",
  "procédure",
  "procedure",
  "occupé sans bail",
  "occupe sans bail",
  "servitude",
  "copropriété dégradée",
  "copropriete degradee",
  "bail commercial contraignant",
  "enchères",
  "encheres",
  "saisie",
];

const EMPTY_ANNONCE = {
  source: "manual",
  source_url: "",
  titre: "",
  description: "",
  prix: "",
  surface_m2: "",
  ville: "",
  code_postal: "",
  type_bien: "",
  nb_pieces: "",
  vendeur_type: "inconnu",
  url_photo: "",
};

function safeText(value) {
  return String(value || "").toLowerCase();
}

function fmtEur(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
}

function daysBetween(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((new Date() - d) / (1000 * 60 * 60 * 24)));
}

function getCategory(score) {
  const n = Number(score || 0);
  if (n >= 80) return "A+";
  if (n >= 65) return "A";
  if (n >= 50) return "B";
  if (n >= 35) return "C";
  return "D";
}

function getAgeBadge(annonce) {
  const days = daysBetween(annonce?.premiere_detection || annonce?.created_at);
  if (days === null) return { label: "—", bg: "rgba(148,163,184,0.14)", color: "#64748b" };
  if (days <= 7) return { label: "🟢 Frais", bg: "rgba(34,197,94,0.10)", color: "#15803d" };
  if (days <= 21) return { label: "🟡 En marché", bg: "rgba(234,179,8,0.12)", color: "#a16207" };
  if (days <= 45) return { label: "🟠 À surveiller", bg: "rgba(249,115,22,0.12)", color: "#c2410c" };
  return { label: "🔴 Négociation possible", bg: "rgba(239,68,68,0.12)", color: "#b91c1c" };
}

function getCategoryStyle(category) {
  if (category === "A+") return { bg: "rgba(16,185,129,0.14)", color: "#047857" };
  if (category === "A") return { bg: "rgba(34,197,94,0.12)", color: "#15803d" };
  if (category === "B") return { bg: "rgba(59,130,246,0.12)", color: "#1d4ed8" };
  if (category === "C") return { bg: "rgba(245,158,11,0.14)", color: "#b45309" };
  return { bg: "rgba(148,163,184,0.14)", color: "#475569" };
}

function hasPriceDrop(annonce) {
  const history = Array.isArray(annonce?.prix_historique) ? annonce.prix_historique : [];
  if (history.length < 2) return false;
  const first = Number(history[0]?.prix || 0);
  const last = Number(history[history.length - 1]?.prix || 0);
  return first > 0 && last > 0 && last < first;
}

function computeSourcingAnalysis(annonce) {
  const text = `${safeText(annonce?.titre)} ${safeText(annonce?.description)}`;

  const detectedPositive = POSITIVE_KEYWORDS.filter((keyword) =>
    text.includes(keyword.toLowerCase())
  );
  const detectedNegative = NEGATIVE_KEYWORDS.filter((keyword) =>
    text.includes(keyword.toLowerCase())
  );

  const prix = Number(annonce?.prix || 0);
  const surface = Number(annonce?.surface_m2 || 0);
  const prixM2 = prix > 0 && surface > 0 ? prix / surface : null;

  let score = 0;
  const pointsForts = [];
  const pointsFaibles = [];

  if (prixM2 && prixM2 < 1400) {
    score += 25;
    pointsForts.push("Prix au m² potentiellement très intéressant");
  } else if (prixM2 && prixM2 < 2000) {
    score += 18;
    pointsForts.push("Prix au m² intéressant à vérifier avec le marché local");
  } else if (prixM2 && prixM2 < 2500) {
    score += 10;
  } else {
    pointsFaibles.push("Prix au m² à vérifier");
  }

  const ville = safeText(annonce?.ville);
  if (
    ville.includes("angers") ||
    ville.includes("avrillé") ||
    ville.includes("avrille") ||
    ville.includes("trélazé") ||
    ville.includes("trelaze") ||
    ville.includes("ponts-de-cé") ||
    ville.includes("ponts de ce") ||
    ville.includes("maine-et-loire")
  ) {
    score += 15;
    pointsForts.push("Localisation cohérente avec la zone Profero Invest");
  } else if (ville) {
    score += 7;
  }

  const travauxKeywords = ["travaux", "à rénover", "a renover", "rénovation", "renovation", "ancien", "rafraîchir", "rafraichir"];
  if (travauxKeywords.some((keyword) => text.includes(keyword))) {
    score += 15;
    pointsForts.push("Présence de travaux ou rénovation permettant une création de valeur");
  }

  const divisionKeywords = ["division", "divisible", "plusieurs logements", "immeuble", "plateau", "combles", "grenier", "dépendance", "dependance"];
  if (divisionKeywords.some((keyword) => text.includes(keyword))) {
    score += 15;
    pointsForts.push("Potentiel de division ou de création de lots à étudier");
  } else if (surface >= 120) {
    score += 8;
    pointsForts.push("Surface importante pouvant permettre une réflexion de division");
  }

  if (
    text.includes("rentabilité") ||
    text.includes("rentabilite") ||
    text.includes("investisseur") ||
    text.includes("colocation") ||
    text.includes("coliving") ||
    text.includes("vendu loué") ||
    text.includes("vendu loue")
  ) {
    score += 15;
    pointsForts.push("Annonce orientée investisseur ou potentiel locatif");
  } else if (surface >= 80) {
    score += 7;
  }

  if (
    text.includes("immeuble") ||
    text.includes("local commercial") ||
    text.includes("plusieurs logements") ||
    text.includes("fort potentiel")
  ) {
    score += 10;
    pointsForts.push("Typologie rare ou recherchée");
  }

  if (detectedNegative.length > 0) {
    const malus = Math.min(20, detectedNegative.length * 8);
    score -= malus;
    pointsFaibles.push(`Points de vigilance détectés : ${detectedNegative.join(", ")}`);
  }

  if (!prix) pointsFaibles.push("Prix absent ou non renseigné");
  if (!surface) pointsFaibles.push("Surface absente ou non renseignée");
  if (!annonce?.description) pointsFaibles.push("Description insuffisante");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const categorie = getCategory(score);

  return {
    score_opportunite: score,
    categorie,
    mots_cles_detectes: detectedPositive,
    points_forts: pointsForts.length ? pointsForts : ["Bien à analyser manuellement"],
    points_faibles: pointsFaibles.length ? pointsFaibles : ["Aucun point bloquant détecté automatiquement"],
    commentaire_analyse:
      score >= 65
        ? "Bien intéressant pour Profero Invest. À qualifier rapidement : état technique, divisibilité, règlement d’urbanisme, potentiel locatif et marge de négociation."
        : "Bien à surveiller ou à analyser manuellement avant décision.",
  };
}

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getStyles(T) {
  const border = T?.border || "rgba(148,163,184,0.25)";
  const card = T?.card || "#ffffff";
  const text = T?.text || "#0f172a";
  const textSub = T?.textSub || "#64748b";
  const accent = T?.accent || "#b8892f";
  const accentBg = T?.accentBg || "rgba(184,137,47,0.14)";
  const inputBg = T?.inputBg || "rgba(148,163,184,0.08)";

  const cardStyle = {
    border: `1px solid ${border}`,
    background: card,
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 8px 30px rgba(15,23,42,0.06)",
  };

  const inputStyle = {
    width: "100%",
    border: `1px solid ${border}`,
    background: card,
    color: text,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    outline: "none",
  };

  const buttonPrimary = {
    border: "none",
    borderRadius: 999,
    padding: "10px 16px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 900,
    background: text,
    color: card,
  };

  const buttonSecondary = {
    border: "none",
    borderRadius: 999,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 850,
    background: inputBg,
    color: textSub,
  };

  return { border, card, text, textSub, accent, accentBg, inputBg, cardStyle, inputStyle, buttonPrimary, buttonSecondary };
}

function Pill({ children, bg, color }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "5px 10px",
      fontSize: 12,
      fontWeight: 850,
      background: bg || "rgba(148,163,184,0.14)",
      color: color || "#475569",
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function StatCard({ label, value, T }) {
  const S = getStyles(T);
  return (
    <div style={S.cardStyle}>
      <div style={{ fontSize: 13, color: S.textSub }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, color: S.text }}>{value}</div>
    </div>
  );
}

function Field({ label, children, T }) {
  const S = getStyles(T);
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block",
        marginBottom: 6,
        fontSize: 11,
        fontWeight: 900,
        letterSpacing: 0.7,
        textTransform: "uppercase",
        color: S.textSub,
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export default function Sourcing({ profil, T }) {
  const S = getStyles(T);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [annonces, setAnnonces] = useState([]);
  const [criteres, setCriteres] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterStatut, setFilterStatut] = useState("tous");
  const [filterSearch, setFilterSearch] = useState("");
  const [newAnnonce, setNewAnnonce] = useState(EMPTY_ANNONCE);

  async function loadData() {
    setLoading(true);

    const [annoncesRes, criteresRes, logsRes] = await Promise.all([
      supabase
        .from("sourcing_annonces")
        .select("*")
        .eq("is_archived", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("sourcing_criteres")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("sourcing_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (annoncesRes.error) console.error("Erreur chargement sourcing_annonces", annoncesRes.error);
    if (criteresRes.error) console.error("Erreur chargement sourcing_criteres", criteresRes.error);
    if (logsRes.error) console.error("Erreur chargement sourcing_logs", logsRes.error);

    setAnnonces(annoncesRes.data || []);
    setCriteres(criteresRes.data || []);
    setLogs(logsRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const total = annonces.length;
    const hot = annonces.filter((a) => ["A+", "A"].includes(a.categorie)).length;
    const drops = annonces.filter((a) => hasPriceDrop(a)).length;
    const toContact = annonces.filter((a) => a.statut === "a_contacter").length;
    const old = annonces.filter((a) => {
      const d = daysBetween(a.premiere_detection || a.created_at);
      return d !== null && d >= 45;
    }).length;
    const top = [...annonces]
      .sort((a, b) => Number(b.score_opportunite || 0) - Number(a.score_opportunite || 0))
      .slice(0, 10);
    return { total, hot, drops, toContact, old, top };
  }, [annonces]);

  const filteredAnnonces = useMemo(() => {
    const search = safeText(filterSearch);
    return annonces.filter((a) => {
      if (filterStatut !== "tous" && a.statut !== filterStatut) return false;
      if (!search) return true;
      const haystack = safeText(`${a.titre || ""} ${a.description || ""} ${a.ville || ""} ${a.code_postal || ""}`);
      return haystack.includes(search);
    });
  }, [annonces, filterSearch, filterStatut]);

  function updateAnnonceField(field, value) {
    setNewAnnonce((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreateAnnonce(e) {
    e.preventDefault();
    if (!String(newAnnonce.titre || "").trim()) {
      alert("Merci d’indiquer au minimum un titre.");
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      ...newAnnonce,
      prix: parseNumber(newAnnonce.prix),
      surface_m2: parseNumber(newAnnonce.surface_m2),
      nb_pieces: parseNumber(newAnnonce.nb_pieces),
      premiere_detection: now,
      derniere_detection: now,
      prix_historique: newAnnonce.prix ? [{ date: now, prix: Number(newAnnonce.prix) }] : [],
      statut: "nouveau",
      is_archived: false,
    };

    const analysis = computeSourcingAnalysis(payload);
    const { error } = await supabase.from("sourcing_annonces").insert({ ...payload, ...analysis });

    if (error) {
      console.error(error);
      alert("Erreur lors de la création de l’annonce.");
      setSaving(false);
      return;
    }

    setNewAnnonce(EMPTY_ANNONCE);
    setSaving(false);
    await loadData();
    setActiveTab("annonces");
  }

  async function handleUpdateStatut(annonce, statut) {
    const { error } = await supabase
      .from("sourcing_annonces")
      .update({ statut })
      .eq("id", annonce.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de la mise à jour du statut.");
      return;
    }

    setAnnonces((prev) => prev.map((a) => (a.id === annonce.id ? { ...a, statut } : a)));
  }

  async function handleAnalyseAnnonce(annonce) {
    const analysis = computeSourcingAnalysis(annonce);
    const { error } = await supabase
      .from("sourcing_annonces")
      .update(analysis)
      .eq("id", annonce.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de l’analyse automatique.");
      return;
    }

    setAnnonces((prev) => prev.map((a) => (a.id === annonce.id ? { ...a, ...analysis } : a)));
  }

  async function handleArchiveAnnonce(annonce) {
    const ok = window.confirm("Archiver cette annonce ?");
    if (!ok) return;

    const { error } = await supabase
      .from("sourcing_annonces")
      .update({ is_archived: true, statut: "archive" })
      .eq("id", annonce.id);

    if (error) {
      console.error(error);
      alert("Erreur lors de l’archivage.");
      return;
    }

    setAnnonces((prev) => prev.filter((a) => a.id !== annonce.id));
  }

  const preview = useMemo(() => computeSourcingAnalysis({
    ...newAnnonce,
    prix: Number(newAnnonce.prix || 0),
    surface_m2: Number(newAnnonce.surface_m2 || 0),
  }), [newAnnonce]);

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "annonces", label: "Annonces détectées" },
    { id: "criteres", label: "Critères de recherche" },
    { id: "analyse", label: "Analyse automatique" },
    { id: "logs", label: "Historique / logs" },
  ];

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto", color: S.text }}>
      <div style={S.cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, color: S.accent }}>
            Profero Invest
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: 0.2, color: S.text }}>
            Sourcing
          </h1>
          <p style={{ margin: 0, maxWidth: 920, fontSize: 14, lineHeight: 1.6, color: S.textSub }}>
            Radar d’opportunités immobilières destiné à détecter, analyser et qualifier les annonces intéressantes avant leur transformation en fiche bien dans le Stock de biens.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 14, marginTop: 18 }}>
        <StatCard T={T} label="Annonces détectées" value={stats.total} />
        <StatCard T={T} label="Opportunités A / A+" value={stats.hot} />
        <StatCard T={T} label="Baisses de prix" value={stats.drops} />
        <StatCard T={T} label="À contacter" value={stats.toContact} />
        <StatCard T={T} label="+45 jours" value={stats.old} />
      </div>

      <div style={{ ...S.cardStyle, marginTop: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 16, borderBottom: `1px solid ${S.border}` }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  border: "none",
                  borderRadius: 999,
                  padding: "9px 14px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 900,
                  background: active ? S.accentBg : S.inputBg,
                  color: active ? S.accent : S.textSub,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 20 }}>
          {loading ? (
            <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none", color: S.textSub }}>
              Chargement du module Sourcing...
            </div>
          ) : (
            <>
              {activeTab === "dashboard" && (
                <DashboardTab T={T} stats={stats} setActiveTab={setActiveTab} />
              )}

              {activeTab === "annonces" && (
                <AnnoncesTab
                  T={T}
                  annonces={filteredAnnonces}
                  filterStatut={filterStatut}
                  setFilterStatut={setFilterStatut}
                  filterSearch={filterSearch}
                  setFilterSearch={setFilterSearch}
                  onUpdateStatut={handleUpdateStatut}
                  onAnalyse={handleAnalyseAnnonce}
                  onArchive={handleArchiveAnnonce}
                />
              )}

              {activeTab === "criteres" && (
                <CriteresTab T={T} criteres={criteres} />
              )}

              {activeTab === "analyse" && (
                <AnalyseTab
                  T={T}
                  newAnnonce={newAnnonce}
                  updateAnnonceField={updateAnnonceField}
                  preview={preview}
                  saving={saving}
                  onSubmit={handleCreateAnnonce}
                />
              )}

              {activeTab === "logs" && (
                <LogsTab T={T} logs={logs} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardTab({ T, stats, setActiveTab }) {
  const S = getStyles(T);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Vue d’ensemble du sourcing</h2>
        <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: S.textSub }}>
          Cette page affiche les annonces détectées, les biens chauds, les baisses de prix et les opportunités à contacter.
        </p>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: S.text }}>Top opportunités</h3>
          <button type="button" onClick={() => setActiveTab("annonces")} style={S.buttonPrimary}>
            Voir toutes les annonces
          </button>
        </div>

        {stats.top.length === 0 ? (
          <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>
            Aucune annonce pour le moment. Ajoute une première annonce dans l’onglet “Analyse automatique”.
          </div>
        ) : (
          <SimpleTable T={T}>
            <thead>
              <tr>
                <Th T={T}>Bien</Th>
                <Th T={T}>Ville</Th>
                <Th T={T}>Prix</Th>
                <Th T={T}>Score</Th>
                <Th T={T}>Catégorie</Th>
                <Th T={T}>Statut</Th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((a) => {
                const catStyle = getCategoryStyle(a.categorie);
                return (
                  <tr key={a.id}>
                    <Td T={T} strong>{a.titre || "Sans titre"}</Td>
                    <Td T={T}>{a.ville || "—"}</Td>
                    <Td T={T}>{fmtEur(a.prix)}</Td>
                    <Td T={T} strong>{fmtNumber(a.score_opportunite)}/100</Td>
                    <Td T={T}><Pill bg={catStyle.bg} color={catStyle.color}>{a.categorie || "D"}</Pill></Td>
                    <Td T={T}>{STATUS_LABELS[a.statut] || a.statut || "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </SimpleTable>
        )}
      </div>
    </div>
  );
}

function AnnoncesTab({ T, annonces, filterStatut, setFilterStatut, filterSearch, setFilterSearch, onUpdateStatut, onAnalyse, onArchive }) {
  const S = getStyles(T);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none", display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Annonces détectées</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: S.textSub }}>Qualification des annonces avant transformation en fiche bien.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Rechercher ville, titre..." style={{ ...S.inputStyle, width: 230 }} />
          <select value={filterStatut} onChange={(e) => setFilterStatut(e.target.value)} style={{ ...S.inputStyle, width: 210 }}>
            <option value="tous">Tous les statuts</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {annonces.length === 0 ? (
        <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>
          Aucune annonce ne correspond aux filtres.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${S.border}`, borderRadius: 18 }}>
          <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: S.inputBg }}>
              <tr>
                <Th T={T}>Bien</Th>
                <Th T={T}>Ville</Th>
                <Th T={T}>Prix</Th>
                <Th T={T}>Surface</Th>
                <Th T={T}>Prix/m²</Th>
                <Th T={T}>Score</Th>
                <Th T={T}>Catégorie</Th>
                <Th T={T}>Ancienneté</Th>
                <Th T={T}>Statut</Th>
                <Th T={T}>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {annonces.map((a) => {
                const badge = getAgeBadge(a);
                const catStyle = getCategoryStyle(a.categorie);
                return (
                  <tr key={a.id} style={{ borderTop: `1px solid ${S.border}`, verticalAlign: "top" }}>
                    <Td T={T}>
                      <div style={{ display: "flex", gap: 12 }}>
                        <div style={{ width: 64, height: 54, borderRadius: 14, overflow: "hidden", background: S.inputBg, flexShrink: 0 }}>
                          {a.url_photo ? <img src={a.url_photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
                            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: S.textSub }}>Photo</div>
                          )}
                        </div>
                        <div>
                          <div style={{ maxWidth: 320, fontWeight: 900, color: S.text }}>{a.titre || "Sans titre"}</div>
                          {a.source_url && (
                            <a href={a.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 4, fontSize: 12, fontWeight: 850, color: S.accent, textDecoration: "none" }}>
                              Voir annonce
                            </a>
                          )}
                          {hasPriceDrop(a) && <div style={{ marginTop: 5, fontSize: 12, fontWeight: 900, color: "#b91c1c" }}>Baisse de prix détectée</div>}
                        </div>
                      </div>
                    </Td>
                    <Td T={T}>{a.ville || "—"}{a.code_postal ? <div style={{ fontSize: 11, color: S.textSub }}>{a.code_postal}</div> : null}</Td>
                    <Td T={T} strong>{fmtEur(a.prix)}</Td>
                    <Td T={T}>{fmtNumber(a.surface_m2)} m²</Td>
                    <Td T={T}>{fmtEur(a.prix_m2)}</Td>
                    <Td T={T} strong>{fmtNumber(a.score_opportunite)}/100</Td>
                    <Td T={T}><Pill bg={catStyle.bg} color={catStyle.color}>{a.categorie || "D"}</Pill></Td>
                    <Td T={T}><Pill bg={badge.bg} color={badge.color}>{badge.label}</Pill></Td>
                    <Td T={T}>
                      <select value={a.statut || "nouveau"} onChange={(e) => onUpdateStatut(a, e.target.value)} style={{ ...S.inputStyle, width: 160 }}>
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </Td>
                    <Td T={T}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        <button type="button" onClick={() => onAnalyse(a)} style={{ ...S.buttonSecondary, color: S.accent, background: S.accentBg }}>Analyser</button>
                        <button type="button" onClick={() => alert("Prochaine étape : création automatique d’une fiche bien dans Stock de biens.")} style={S.buttonPrimary}>Créer fiche bien</button>
                        <button type="button" onClick={() => onArchive(a)} style={{ ...S.buttonSecondary, color: "#b91c1c", background: "rgba(239,68,68,0.10)" }}>Archiver</button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CriteresTab({ T, criteres }) {
  const S = getStyles(T);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Critères de recherche</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: S.textSub }}>
          Les critères sont lus depuis Supabase. La création/modification depuis l’interface sera ajoutée après validation de cette connexion.
        </p>
      </div>

      {criteres.length === 0 ? (
        <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>Aucun critère trouvé.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
          {criteres.map((c) => (
            <div key={c.id} style={S.cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: S.text }}>{c.nom}</h3>
                  <p style={{ margin: "5px 0 0", fontSize: 13, color: S.textSub }}>Source : {c.source || "—"} · Fréquence : {c.frequence || "—"}</p>
                </div>
                <Pill bg={c.actif ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.14)"} color={c.actif ? "#15803d" : S.textSub}>
                  {c.actif ? "Actif" : "Inactif"}
                </Pill>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 16, fontSize: 13, color: S.textSub }}>
                <div>Prix : {fmtEur(c.prix_min)} à {fmtEur(c.prix_max)}</div>
                <div>Surface : {fmtNumber(c.surface_min)} à {fmtNumber(c.surface_max)} m²</div>
                <div>Pièces min : {fmtNumber(c.pieces_min)}</div>
                <div>Score alerte : {fmtNumber(c.score_min_alerte)}/100</div>
              </div>

              {Array.isArray(c.zones) && c.zones.length > 0 && <TagList title="Zones" values={c.zones} T={T} />}
              {Array.isArray(c.types_biens) && c.types_biens.length > 0 && <TagList title="Types de biens" values={c.types_biens} T={T} />}
              {Array.isArray(c.mots_cles_inclus) && c.mots_cles_inclus.length > 0 && <TagList title="Mots-clés inclus" values={c.mots_cles_inclus} T={T} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyseTab({ T, newAnnonce, updateAnnonceField, preview, saving, onSubmit }) {
  const S = getStyles(T);
  const catStyle = getCategoryStyle(preview.categorie);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 18 }}>
      <form onSubmit={onSubmit} style={S.cardStyle}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Ajouter une annonce test</h2>
        <p style={{ margin: "6px 0 18px", fontSize: 13, color: S.textSub }}>
          Cette zone permet de tester l’analyse automatique avant de brancher la collecte Leboncoin.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <Field label="Titre" T={T}><input value={newAnnonce.titre} onChange={(e) => updateAnnonceField("titre", e.target.value)} style={S.inputStyle} placeholder="Maison à rénover avec dépendance" /></Field>
          <Field label="Lien source" T={T}><input value={newAnnonce.source_url} onChange={(e) => updateAnnonceField("source_url", e.target.value)} style={S.inputStyle} placeholder="https://www.leboncoin.fr/..." /></Field>
          <Field label="Prix" T={T}><input type="number" value={newAnnonce.prix} onChange={(e) => updateAnnonceField("prix", e.target.value)} style={S.inputStyle} placeholder="180000" /></Field>
          <Field label="Surface m²" T={T}><input type="number" value={newAnnonce.surface_m2} onChange={(e) => updateAnnonceField("surface_m2", e.target.value)} style={S.inputStyle} placeholder="150" /></Field>
          <Field label="Ville" T={T}><input value={newAnnonce.ville} onChange={(e) => updateAnnonceField("ville", e.target.value)} style={S.inputStyle} placeholder="Angers" /></Field>
          <Field label="Code postal" T={T}><input value={newAnnonce.code_postal} onChange={(e) => updateAnnonceField("code_postal", e.target.value)} style={S.inputStyle} placeholder="49000" /></Field>
          <Field label="Type de bien" T={T}><input value={newAnnonce.type_bien} onChange={(e) => updateAnnonceField("type_bien", e.target.value)} style={S.inputStyle} placeholder="Maison / Immeuble / Appartement" /></Field>
          <Field label="Nombre de pièces" T={T}><input type="number" value={newAnnonce.nb_pieces} onChange={(e) => updateAnnonceField("nb_pieces", e.target.value)} style={S.inputStyle} placeholder="6" /></Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="URL photo principale" T={T}><input value={newAnnonce.url_photo} onChange={(e) => updateAnnonceField("url_photo", e.target.value)} style={S.inputStyle} placeholder="https://..." /></Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Description" T={T}>
            <textarea value={newAnnonce.description} onChange={(e) => updateAnnonceField("description", e.target.value)} style={{ ...S.inputStyle, minHeight: 140, resize: "vertical" }} placeholder="Description de l’annonce..." />
          </Field>
        </div>

        <button type="submit" disabled={saving} style={{ ...S.buttonPrimary, marginTop: 16, opacity: saving ? 0.55 : 1 }}>
          {saving ? "Enregistrement..." : "Ajouter et analyser"}
        </button>
      </form>

      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Aperçu analyse automatique</h3>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 44, fontWeight: 950, color: S.text }}>{preview.score_opportunite}</div>
          <div>
            <div style={{ fontSize: 13, color: S.textSub }}>Score opportunité</div>
            <div style={{ marginTop: 5 }}><Pill bg={catStyle.bg} color={catStyle.color}>Catégorie {preview.categorie}</Pill></div>
          </div>
        </div>

        <AnalysisBlock T={T} title="Mots-clés détectés" items={preview.mots_cles_detectes} empty="Aucun mot-clé détecté" />
        <AnalysisBlock T={T} title="Points forts" items={preview.points_forts} />
        <AnalysisBlock T={T} title="Points faibles" items={preview.points_faibles} />
      </div>
    </div>
  );
}

function LogsTab({ T, logs }) {
  const S = getStyles(T);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...S.cardStyle, background: S.inputBg, boxShadow: "none" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: S.text }}>Historique et logs</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: S.textSub }}>Cette zone affichera les exécutions de collecte Leboncoin et les imports.</p>
      </div>
      {logs.length === 0 ? (
        <div style={{ ...S.cardStyle, borderStyle: "dashed", boxShadow: "none", color: S.textSub }}>Aucun log pour le moment.</div>
      ) : (
        <SimpleTable T={T}>
          <thead>
            <tr>
              <Th T={T}>Date</Th>
              <Th T={T}>Source</Th>
              <Th T={T}>Statut</Th>
              <Th T={T}>Détectées</Th>
              <Th T={T}>Nouvelles</Th>
              <Th T={T}>Message</Th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <Td T={T}>{log.created_at ? new Date(log.created_at).toLocaleString("fr-FR") : "—"}</Td>
                <Td T={T}>{log.source || "—"}</Td>
                <Td T={T} strong>{log.statut || "—"}</Td>
                <Td T={T}>{log.nb_detectees || 0}</Td>
                <Td T={T}>{log.nb_nouvelles || 0}</Td>
                <Td T={T}>{log.message || "—"}</Td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}

function SimpleTable({ T, children }) {
  const S = getStyles(T);
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${S.border}`, borderRadius: 18 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        {children}
      </table>
    </div>
  );
}

function Th({ T, children }) {
  const S = getStyles(T);
  return (
    <th style={{
      padding: "12px 14px",
      textAlign: "left",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      color: S.textSub,
      background: S.inputBg,
      whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}

function Td({ T, children, strong = false }) {
  const S = getStyles(T);
  return (
    <td style={{
      padding: "12px 14px",
      borderTop: `1px solid ${S.border}`,
      color: strong ? S.text : S.textSub,
      fontWeight: strong ? 850 : 500,
      verticalAlign: "top",
    }}>
      {children}
    </td>
  );
}

function TagList({ title, values, T }) {
  const S = getStyles(T);
  const safeValues = Array.isArray(values) ? values : [];
  if (safeValues.length === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ marginBottom: 7, fontSize: 11, fontWeight: 900, letterSpacing: 0.7, textTransform: "uppercase", color: S.textSub }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {safeValues.map((value) => <Pill key={value} bg={S.inputBg} color={S.textSub}>{value}</Pill>)}
      </div>
    </div>
  );
}

function AnalysisBlock({ T, title, items, empty = "Aucun élément" }) {
  const S = getStyles(T);
  const safeItems = Array.isArray(items) ? items : [];

  return (
    <div style={{ marginTop: 18 }}>
      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: S.text }}>{title}</h4>
      {safeItems.length === 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: S.textSub }}>{empty}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {safeItems.map((item, index) => (
            <div key={`${item}-${index}`} style={{ border: `1px solid ${S.border}`, background: S.card, borderRadius: 12, padding: "9px 11px", fontSize: 13, color: S.textSub }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
