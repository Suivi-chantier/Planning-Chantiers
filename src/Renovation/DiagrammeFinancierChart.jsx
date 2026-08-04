// DiagrammeFinancierChart — rendu recharts du diagramme financier (Point 5).
//
// Composant d'AFFICHAGE pur : reçoit les lignes fusionnées par
// fusionnerSeriesPourGraphe (une ligne par mois, 6 clés de série) et dessine
// les courbes cumulées — réel en trait plein, référence figée en pointillés,
// une couleur par flux. Aucun calcul financier ici.
//
// Importé via React.lazy() par ses hôtes (fiche chantier, consolidé) pour que
// recharts reste dans le chunk "charts" de vite.config et ne pèse pas sur le
// chargement des pages qui n'affichent pas le diagramme.
import React from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend,
} from "recharts";

// Une couleur par FLUX (le style de trait distingue réel / référence).
export const COULEURS_FLUX = {
  valeur: "#22c55e",    // valeur générée
  recettes: "#5B8AF5",  // facturation
  depenses: "#e15a5a",  // dépenses
};

const SERIES = [
  { key: "valReel", flux: "valeur",   ref: false, nom: "Valeur générée (réel)" },
  { key: "valRef",  flux: "valeur",   ref: true,  nom: "Valeur générée (référence)" },
  { key: "recReel", flux: "recettes", ref: false, nom: "Facturation (réel)" },
  { key: "recRef",  flux: "recettes", ref: true,  nom: "Facturation (référence)" },
  { key: "depReel", flux: "depenses", ref: false, nom: "Dépenses (réel)" },
  { key: "depRef",  flux: "depenses", ref: true,  nom: "Dépenses (référence)" },
];

export default function DiagrammeFinancierChart({ T, data = [], hauteur = 300, masques = {}, onToggleSerie = null }) {
  const fmtEuro = (n) => `${Math.round(n).toLocaleString("fr-FR")} €`;
  // recharts force des couleurs de tooltip illisibles selon le thème : styles
  // explicites depuis T (même parade que DashboardAnalyse).
  const tooltipProps = {
    contentStyle: {
      background: T.cardBg || T.bg || "#fff", border: `1px solid ${T.border}`,
      borderRadius: 10, fontSize: 12.5, color: T.text,
    },
    labelStyle: { color: T.text, fontWeight: 700 },
    itemStyle: { padding: "1px 0" },
    formatter: (v, nom) => [fmtEuro(v), nom],
  };
  // Séries réellement présentes dans les données (au moins un point non null) :
  // pas de ligne fantôme dans la légende quand la référence n'existe pas.
  const presentes = SERIES.filter((s) => data.some((row) => row[s.key] != null));
  return (
    <div style={{ width: "100%", height: hauteur, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: T.textMuted }}
            tickFormatter={(l) => String(l).replace(/ 20(\d\d)$/, " $1")} />
          <YAxis tick={{ fontSize: 11, fill: T.textMuted }} width={52}
            tickFormatter={(v) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} k€` : `${v} €`} />
          <RTooltip {...tooltipProps} />
          <Legend
            wrapperStyle={{ fontSize: 12, cursor: onToggleSerie ? "pointer" : "default" }}
            onClick={onToggleSerie ? (e) => onToggleSerie(e?.dataKey || e?.payload?.dataKey) : undefined}
            formatter={(nom, entry) => (
              <span style={{ color: masques[entry?.dataKey] ? T.textMuted : T.text, opacity: masques[entry?.dataKey] ? 0.55 : 1 }}>{nom}</span>
            )}
          />
          {presentes.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.nom}
              stroke={COULEURS_FLUX[s.flux]}
              strokeWidth={s.ref ? 1.8 : 2.5}
              strokeDasharray={s.ref ? "6 4" : undefined}
              strokeOpacity={masques[s.key] ? 0 : 1}
              dot={s.ref || masques[s.key] ? false : { r: 2.5, strokeWidth: 0, fill: COULEURS_FLUX[s.flux] }}
              activeDot={masques[s.key] ? false : { r: 4 }}
              connectNulls={false} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
