import React from "react";

// Guide ouvrages : embarque le HTML statique servi par Vite depuis /public.
// Le guide a son propre design papier autonome, indépendant du thème de l'appli.
// L'iframe le rend tel quel sans avoir à le réécrire en React.
function PageGuideOuvrages({ T }) {
  return (
    <div style={{
      width: "100%",
      height: "calc(100vh - 0px)",
      background: T?.surface || "#fff",
      display: "flex",
      flexDirection: "column",
    }}>
      <iframe
        src="/referentiel-chantier-profero.html"
        title="Guide ouvrages — Référentiel chantier"
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          background: "#efe9dd",
        }}
      />
    </div>
  );
}

export default PageGuideOuvrages;
