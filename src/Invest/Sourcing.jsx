import React from "react";

export default function Sourcing({ profil, T }) {
  const cardStyle = {
    border: `1px solid ${T?.border || "rgba(148,163,184,0.25)"}`,
    background: T?.card || "white",
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 8px 30px rgba(15,23,42,0.06)",
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto", color: T?.text || "#0f172a" }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: T?.accent || "#b8892f",
          }}>
            Profero Invest
          </div>

          <h1 style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: 0.2,
            color: T?.text || "#0f172a",
          }}>
            Sourcing
          </h1>

          <p style={{
            margin: 0,
            maxWidth: 900,
            fontSize: 14,
            lineHeight: 1.6,
            color: T?.textSub || "#64748b",
          }}>
            Radar d’opportunités immobilières destiné à détecter, analyser et qualifier les annonces intéressantes avant leur transformation en fiche bien dans le Stock de biens.
          </p>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 14,
        marginTop: 18,
      }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: T?.textSub || "#64748b" }}>Annonces détectées</div>
          <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, color: T?.text || "#0f172a" }}>0</div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: T?.textSub || "#64748b" }}>Opportunités A / A+</div>
          <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, color: T?.text || "#0f172a" }}>0</div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: T?.textSub || "#64748b" }}>Baisses de prix</div>
          <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, color: T?.text || "#0f172a" }}>0</div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: T?.textSub || "#64748b" }}>À contacter</div>
          <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900, color: T?.text || "#0f172a" }}>0</div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 18 }}>
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          paddingBottom: 16,
          borderBottom: `1px solid ${T?.border || "rgba(148,163,184,0.25)"}`,
        }}>
          {["Dashboard", "Annonces détectées", "Critères de recherche", "Analyse automatique", "Historique / logs"].map((label, index) => (
            <button
              key={label}
              type="button"
              style={{
                border: "none",
                borderRadius: 999,
                padding: "9px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 800,
                background: index === 0 ? (T?.accentBg || "rgba(184,137,47,0.14)") : (T?.inputBg || "rgba(148,163,184,0.10)"),
                color: index === 0 ? (T?.accent || "#b8892f") : (T?.textSub || "#64748b"),
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{
          marginTop: 20,
          border: "1px dashed rgba(184,137,47,0.45)",
          background: "rgba(184,137,47,0.08)",
          borderRadius: 16,
          padding: 20,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: T?.text || "#0f172a" }}>
            Module Sourcing prêt à être connecté
          </h2>

          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: T?.textSub || "#64748b" }}>
            La prochaine étape sera de connecter cette page aux tables Supabase : <strong>sourcing_annonces</strong>, <strong>sourcing_criteres</strong> et <strong>sourcing_logs</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
