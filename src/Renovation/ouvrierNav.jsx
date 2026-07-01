import React from "react";
import { Icon } from "../ui";
import { MapPin, Navigation } from "lucide-react";

// Helpers de navigation GPS partagés (espace ouvrier).
// On privilégie les coordonnées, sinon on retombe sur l'adresse texte.
export function hasGeo(geo) {
  return !!(geo && ((geo.lat != null && geo.lon != null) || geo.adresse));
}
export function mapsUrl(geo) {
  if (!hasGeo(geo)) return null;
  const dest = (geo.lat != null && geo.lon != null) ? `${geo.lat},${geo.lon}` : geo.adresse;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}
export function wazeUrl(geo) {
  if (!hasGeo(geo)) return null;
  return (geo.lat != null && geo.lon != null)
    ? `https://waze.com/ul?ll=${geo.lat},${geo.lon}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(geo.adresse)}&navigate=yes`;
}

// Deux boutons Maps + Waze qui ouvrent l'app en itinéraire direct.
export function NavButtons({ geo }) {
  const maps = mapsUrl(geo);
  const waze = wazeUrl(geo);
  if (!maps && !waze) return null;
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {maps && (
        <a href={maps} target="_blank" rel="noopener noreferrer" style={{
          display:"inline-flex", alignItems:"center", gap:6, textDecoration:"none",
          background:"#1a73e814", color:"#1a73e8", border:"1px solid #1a73e840",
          borderRadius:12, padding:"8px 14px", fontSize:13.5, fontWeight:700,
        }}>
          <Icon as={MapPin} size={14} strokeWidth={2.2}/>
          Maps
        </a>
      )}
      {waze && (
        <a href={waze} target="_blank" rel="noopener noreferrer" style={{
          display:"inline-flex", alignItems:"center", gap:6, textDecoration:"none",
          background:"#05c8f714", color:"#0797b8", border:"1px solid #05c8f755",
          borderRadius:12, padding:"8px 14px", fontSize:13.5, fontWeight:700,
        }}>
          <Icon as={Navigation} size={14} strokeWidth={2.2}/>
          Waze
        </a>
      )}
    </div>
  );
}
