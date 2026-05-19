// ══════════════════════════════════════════════════════════════════════════════
//  PROFERO INVEST — Modifications v2
//  Remplacer les sections correspondantes dans PageInvest.jsx
//
//  ⚠️  MIGRATIONS SUPABASE REQUISES (SQL Editor) :
//
//  -- Table planning événements (nouvelle)
//  CREATE TABLE IF NOT EXISTS invest_events (
//    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//    titre       TEXT NOT NULL,
//    date        DATE NOT NULL,
//    type        TEXT DEFAULT 'Autre',
//    notes       TEXT,
//    created_by  TEXT,
//    created_at  TIMESTAMPTZ DEFAULT now()
//  );
//  ALTER TABLE invest_events ENABLE ROW LEVEL SECURITY;
//  CREATE POLICY "auth_all" ON invest_events FOR ALL TO authenticated USING (true);
//
//  -- Nouveau champ clients
//  ALTER TABLE invest_clients ADD COLUMN IF NOT EXISTS date_avant_contact DATE;
//
// ══════════════════════════════════════════════════════════════════════════════


// ─── NOUVELLES CONSTANTES — ajouter avec les autres constantes en haut du fichier ──

const ETAPES_CLIENT = [
  "",
  "1 — Signature contrat",
  "2 — Envoi des documents d'analyse",
  "3 — Définition de la stratégie d'investissement",
  "4 — Recherche du projet (visites et analyse)",
  "5 — Présentation des projets",
  "6 — Offre d'achat",
  "7 — Réalisation des devis précis",
  "8 — Signature du compromis",
  "9 — Réalisation du dossier bancaire",
  "10 — Obtention du financement",
  "11 — Réalisation des dossiers d'urbanismes",
  "12 — Validation des conditions suspensives d'achat",
  "13 — Signature Notaire",
];

const EVENT_TYPES = ["Visite", "RDV Commercial", "Réunion", "Appel", "Autre"];
const EVENT_ICONS = { Visite: "🏠", "RDV Commercial": "🤝", Réunion: "👥", Appel: "📞", Autre: "📌" };
const EVENT_COLORS = {
  Visite: "#4070e8", "RDV Commercial": "#50c878",
  Réunion: "#c084fc", Appel: "#FFC200", Autre: "#9aa0b0",
};


// ─── GEOCODING — ajouter avec les autres helpers ──────────────────────────────

const _geoCache = {};
async function geocodeAddress(adresse, ville) {
  const q = [adresse, ville, "France"].filter(Boolean).join(", ");
  if (_geoCache[q]) return _geoCache[q];
  try {
    await new Promise(r => setTimeout(r, 320)); // rate-limit Nominatim 1 req/s
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=fr`,
      { headers: { "User-Agent": "ProferoInvest/2.0" } }
    );
    const d = await r.json();
    if (d?.[0]) {
      const res = { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
      _geoCache[q] = res;
      return res;
    }
  } catch {}
  return null;
}


// ══════════════════════════════════════════════════════════════════════════════
// ─── CARTE STOCK BIENS (nouveau composant)  ───────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function CarteStockBiens({ biens, T = THEMES_INV.dark }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markersRef   = useRef([]);
  const [mapReady,   setMapReady]   = useState(false);
  const [geocoding,  setGeocoding]  = useState(false);
  const [progress,   setProgress]   = useState(0);

  // Charge Leaflet (CSS + JS) une seule fois
  useEffect(() => {
    if (window.L) { setMapReady(true); return; }
    if (!document.getElementById("leaflet-css")) {
      const lk = document.createElement("link");
      lk.id = "leaflet-css"; lk.rel = "stylesheet";
      lk.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(lk);
    }
    const sc = document.createElement("script");
    sc.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    sc.onload = () => setMapReady(true);
    document.head.appendChild(sc);
  }, []);

  // Initialise la carte après chargement de Leaflet
  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(containerRef.current).setView([46.5, 2.5], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
  }, [mapReady]);

  // Géocode et place les markers quand la liste des biens change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const L   = window.L;
    const map = mapRef.current;
    let cancelled = false;

    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    const valides = biens.filter(b => b.adresse || b.ville);
    if (!valides.length) return;
    setGeocoding(true); setProgress(0);

    (async () => {
      const bounds = [];
      for (let i = 0; i < valides.length; i++) {
        if (cancelled) return;
        const b = valides[i];
        const coords = await geocodeAddress(b.adresse, b.ville);
        setProgress(Math.round(((i + 1) / valides.length) * 100));
        if (!coords || cancelled) continue;

        const color = STATUT_BIEN_COLORS[b.statut] || "#9aa0b0";
        const icon  = L.divIcon({
          className: "",
          html: `<div style="
            width:14px;height:14px;border-radius:50%;
            background:${color};border:2.5px solid white;
            box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;
            transition:transform .12s;
          " onmouseover="this.style.transform='scale(1.7)'"
             onmouseout="this.style.transform='scale(1)'"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -13],
        });

        const fmtEur = v => v > 0 ? new Intl.NumberFormat("fr-FR").format(v) + " €" : "—";
        const popup  = `
          <div style="font-family:'Segoe UI',Arial,sans-serif;min-width:210px;padding:2px 0">
            <div style="font-weight:700;font-size:13px;color:#1a2d4a;margin-bottom:3px">
              ${b.adresse || "Sans adresse"}
            </div>
            ${b.ville ? `<div style="font-size:11px;color:#5a6070;margin-bottom:7px">
              📍 ${b.ville}${b.code_postal ? " " + b.code_postal : ""}
            </div>` : ""}
            <span style="
              display:inline-block;padding:2px 10px;border-radius:12px;
              font-size:10px;font-weight:700;margin-bottom:9px;
              background:${color}20;color:${color};border:1px solid ${color}40;
            ">${b.statut || "—"}</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
              ${b.cout_total > 0 ? `<div style="background:#f5f7fa;border-radius:6px;padding:5px 8px">
                <div style="font-size:9px;color:#9aa0b0;text-transform:uppercase;letter-spacing:.5px">Coût total</div>
                <div style="font-weight:700;font-size:12px;color:#1a2d4a">${fmtEur(b.cout_total)}</div>
              </div>` : ""}
              ${b.rendement_brut > 0 ? `<div style="background:#f0faf4;border-radius:6px;padding:5px 8px">
                <div style="font-size:9px;color:#9aa0b0;text-transform:uppercase;letter-spacing:.5px">Rendement</div>
                <div style="font-weight:700;font-size:12px;color:#1a7a4a">${b.rendement_brut.toFixed(1)} %</div>
              </div>` : ""}
            </div>
            ${b.agence ? `<div style="font-size:11px;color:#9aa0b0;margin-top:7px">${b.agence}</div>` : ""}
            ${b.interlocuteur ? `<div style="font-size:11px;color:#5a6070;margin-top:3px">📞 ${b.interlocuteur}</div>` : ""}
          </div>`;

        const marker = L.marker([coords.lat, coords.lng], { icon }).addTo(map);
        marker.bindPopup(popup, { maxWidth: 270 });
        markersRef.current.push(marker);
        bounds.push([coords.lat, coords.lng]);
      }
      if (!cancelled && bounds.length > 0) {
        if (bounds.length === 1) map.setView(bounds[0], 13);
        else map.fitBounds(bounds, { padding: [50, 50] });
      }
      if (!cancelled) setGeocoding(false);
    })();

    return () => { cancelled = true; };
  }, [biens, mapReady]);

  return (
    <div className="inv-card" style={{ marginBottom: SPACING.lg, position: "relative" }}>
      <div className="inv-card-hd blue" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={MapPin} size={13} strokeWidth={2.2} />
          Carte des biens ({biens.length})
        </span>
        {geocoding && (
          <span style={{ fontSize: FONT.xs.size, color: "rgba(255,255,255,.65)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon as={RefreshCw} size={11} style={{ animation: "spin 1s linear infinite" }} />
            Géocodage {progress}%
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height: 420, borderRadius: `0 0 ${RADIUS.xl}px ${RADIUS.xl}px` }} />
      {!mapReady && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 420,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: T.cardHover, borderRadius: `0 0 ${RADIUS.xl}px ${RADIUS.xl}px`,
          color: T.textMuted, fontSize: FONT.sm.size + 1, gap: 8,
        }}>
          <Icon as={RefreshCw} size={14} style={{ animation: "spin 1s linear infinite" }} />
          Chargement de la carte…
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ─── TABLEAU DE BORD — remplace entièrement le composant TableauBord ──────────
// ══════════════════════════════════════════════════════════════════════════════

function TableauBord({ profil, T = THEMES_INV.dark }) {
  const [stats,          setStats]          = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [actionsUrg,     setActionsUrg]     = useState([]);
  const [planning,       setPlanning]       = useState([]);
  const [modal,          setModal]          = useState(null); // { title, items, itemType }
  const [newEvent,       setNewEvent]       = useState({
    titre: "", date: new Date().toISOString().slice(0, 10), type: "Visite", notes: ""
  });
  const [savingEv, setSavingEv] = useState(false);

  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekEnd    = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const charger = async () => {
    setLoading(true);
    const [{ data: clients }, { data: biens }, { data: props }] = await Promise.all([
      supabase.from("invest_clients").select("*").order("date_prochaine_action"),
      supabase.from("invest_biens").select("*").order("created_at", { ascending: false }),
      supabase.from("invest_propositions").select("client_id,bien_id,created_at"),
    ]);
    // Events manuels (table optionnelle — dégradation gracieuse si absente)
    let manualEvs = [];
    const evR = await supabase.from("invest_events")
      .select("*").gte("date", todayStr).lte("date", weekEndStr).order("date");
    if (!evR.error) manualEvs = evR.data || [];

    const c = clients || [], b = biens || [], p = props || [];

    // Actions en retard ou dans les 7 jours
    setActionsUrg(
      c.filter(x => x.date_prochaine_action && x.date_prochaine_action <= weekEndStr)
       .sort((a, bb) => a.date_prochaine_action.localeCompare(bb.date_prochaine_action))
    );

    // Planning : visites biens + events manuels
    const visitesWeek = b
      .filter(x => x.date_visite && x.date_visite >= todayStr && x.date_visite <= weekEndStr)
      .map(x => ({
        id: `bien-${x.id}`, titre: `Visite — ${x.adresse || x.ville || "Bien"}`,
        date: x.date_visite, type: "Visite", source: "bien",
      }));
    setPlanning([
      ...visitesWeek,
      ...manualEvs.map(e => ({ ...e, source: "manual" })),
    ].sort((a, bb) => a.date.localeCompare(bb.date)));

    setStats({
      prospects:           c.filter(x => x.statut === "Prospect").length,
      actifs:              c.filter(x => x.statut === "Actif").length,
      inactifs:            c.filter(x => x.statut === "Inactif").length,
      termines:            c.filter(x => x.statut === "Terminé").length,
      totalSignes:         c.filter(x => x.date_signature).length,
      sommeBudgets:        c.filter(x => x.date_signature).reduce((s, x) => s + (x.budget || 0), 0),
      biensTotaux:         b.length,
      biensARelancer:      b.filter(x => x.date_relance && x.date_relance <= todayStr).length,
      visitesProg:         b.filter(x => x.statut === "Visite programmée").length,
      offreEnvoyees:       b.filter(x => x.statut === "Offre envoyée").length,
      offresAcceptees:     b.filter(x => x.statut === "Offre acceptée").length,
      sansProchaineAction: c.filter(x => !x.prochaine_action).length,
      nbPropositions:      p.length,
      _c: c, _b: b,
    });
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const ajouterEvent = async () => {
    if (!newEvent.titre.trim() || !newEvent.date) return;
    setSavingEv(true);
    await supabase.from("invest_events").insert({
      titre: newEvent.titre.trim(), date: newEvent.date,
      type: newEvent.type, notes: newEvent.notes || null,
      created_by: profil?.nom || profil?.email || "—",
    });
    setSavingEv(false);
    setNewEvent({ titre: "", date: new Date().toISOString().slice(0, 10), type: "Visite", notes: "" });
    charger();
  };

  const supprimerEvent = async (id) => {
    await supabase.from("invest_events").delete().eq("id", id);
    charger();
  };

  const ouvrirModal = (title, items, itemType) => setModal({ title, items, itemType });

  const fmt     = v => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
  const fmtDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" }) : "—";

  const SC = { Prospect: "#4db8ff", Actif: SU, Inactif: WA, Terminé: "rgba(255,255,255,0.3)" };

  // KPI cliquable
  const KPI = ({ label, value, color, icon: IC, onClick, disabled }) => {
    const c = color || "#FFC200";
    return (
      <div
        className="inv-kpi"
        onClick={!disabled && onClick ? onClick : undefined}
        style={{
          display: "flex", flexDirection: "row", alignItems: "center", gap: SPACING.md,
          borderLeft: `3px solid ${c}`,
          cursor: !disabled && onClick ? "pointer" : "default",
          transition: "all .15s",
        }}
        onMouseEnter={e => { if (!disabled && onClick) e.currentTarget.style.boxShadow = T.shadowMd; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}
      >
        {IC && (
          <div style={{
            width: 38, height: 38, borderRadius: RADIUS.md, flexShrink: 0,
            background: `${c}18`, color: c,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={IC} size={19} strokeWidth={2} />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="inv-kpi-lbl">{label}</div>
          <div className="inv-kpi-val" style={{ color: c, fontSize: FONT.xl.size + 2 }}>{value}</div>
        </div>
        {!disabled && onClick && <Icon as={ChevronRight} size={14} color={T.textMuted} />}
      </div>
    );
  };

  // Modal détail
  const Modal = () => {
    if (!modal) return null;
    const { title, items, itemType } = modal;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, backdropFilter: "blur(4px)" }}
        onClick={() => setModal(null)}>
        <div style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl,
          padding: `${SPACING.xl}px`, maxWidth: 700, width: "93%", maxHeight: "82vh",
          overflowY: "auto", boxShadow: T.shadowMd,
        }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.lg }}>
            <div style={{ fontSize: FONT.h2.size, fontWeight: 800, color: T.text }}>{title} <span style={{ color: T.textMuted, fontWeight: 400 }}>({items.length})</span></div>
            <button onClick={() => setModal(null)} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 22, lineHeight: 1 }}>×</button>
          </div>
          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: `${SPACING.xxl}px 0`, color: T.textMuted, fontStyle: "italic" }}>Aucun élément</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: SPACING.sm - 2 }}>
              {items.map(item => (
                <div key={item.id} style={{
                  padding: `${SPACING.md}px ${SPACING.lg - 2}px`, background: T.cardHover,
                  borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", gap: SPACING.md,
                }}>
                  {itemType === "client" ? (
                    <>
                      <div style={{
                        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                        background: `${SC[item.statut] || T.accent}18`, color: SC[item.statut] || T.accent,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: FONT.sm.size + 1, fontWeight: 800,
                      }}>
                        {`${item.prenom?.[0] || ""}${item.nom?.[0] || ""}`.toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: T.text, fontSize: FONT.base.size }}>{item.prenom} {item.nom}</div>
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{item.email || item.telephone || "—"}</div>
                        {item.etape && <div style={{ fontSize: FONT.xs.size, color: T.accent, marginTop: 2 }}>{item.etape}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        {item.budget > 0 && <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.sm.size, fontWeight: 700, color: T.accent }}>{fmt(item.budget)} €</div>}
                        {item.date_prochaine_action && (
                          <div style={{ fontSize: FONT.xs.size, color: item.date_prochaine_action < todayStr ? DA : T.textMuted, marginTop: 2 }}>
                            {item.date_prochaine_action < todayStr ? "⚠ " : ""}{new Date(item.date_prochaine_action + "T00:00:00").toLocaleDateString("fr-FR")}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{
                        width: 34, height: 34, borderRadius: RADIUS.md, flexShrink: 0,
                        background: `${STATUT_BIEN_COLORS[item.statut] || T.textMuted}18`,
                        color: STATUT_BIEN_COLORS[item.statut] || T.textMuted,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Icon as={Home} size={17} strokeWidth={2} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.adresse || "Sans adresse"}</div>
                        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{item.ville || "—"}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        {item.cout_total > 0 && <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.sm.size, color: T.accent, fontWeight: 700 }}>{fmt(item.cout_total)} €</div>}
                        {item.date_relance && (
                          <div style={{ fontSize: FONT.xs.size, color: item.date_relance < todayStr ? DA : T.textMuted, marginTop: 2 }}>
                            Relance : {new Date(item.date_relance + "T00:00:00").toLocaleDateString("fr-FR")}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const SecTitle = ({ icon: IC, label }) => (
    <div style={{
      fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase",
      letterSpacing: 1.8, marginBottom: SPACING.md, display: "flex", alignItems: "center", gap: SPACING.sm - 2,
    }}>
      <Icon as={IC} size={13} strokeWidth={2} /> {label}
    </div>
  );

  return (
    <div style={{ padding: `${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: SPACING.xl, display: "flex", alignItems: "center", gap: SPACING.md }}>
        <div style={{ width: 48, height: 48, borderRadius: RADIUS.lg, background: T.accentBg, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon as={LayoutDashboard} size={24} strokeWidth={2} />
        </div>
        <div>
          <div style={{ fontSize: FONT.h2.size, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Tableau de bord</div>
          <div style={{ fontSize: FONT.sm.size + 1, color: T.textSub, marginTop: 2 }}>Vue globale · cliquez sur une case pour voir le détail</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: `${SPACING.xxxl}px 0`, color: T.textMuted, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <Icon as={RefreshCw} size={14} style={{ animation: "spin 1s linear infinite" }} /> Chargement…
        </div>
      ) : stats && (<>

        {/* ── CLIENTS ── */}
        <SecTitle icon={Users} label="Clients & Prospects" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: SPACING.md, marginBottom: SPACING.xxl - 2 }}>
          <KPI icon={Users}        label="Prospects"             value={stats.prospects}    color="#4db8ff" onClick={() => ouvrirModal("Prospects", stats._c.filter(x => x.statut === "Prospect"), "client")} />
          <KPI icon={Check}        label="Clients actifs"        value={stats.actifs}       color={SU}      onClick={() => ouvrirModal("Clients actifs", stats._c.filter(x => x.statut === "Actif"), "client")} />
          <KPI icon={Bell}         label="Clients inactifs"      value={stats.inactifs}     color={WA}      onClick={() => ouvrirModal("Clients inactifs", stats._c.filter(x => x.statut === "Inactif"), "client")} />
          <KPI icon={Lock}         label="Terminés"              value={stats.termines}     color={T.textMuted} onClick={() => ouvrirModal("Terminés", stats._c.filter(x => x.statut === "Terminé"), "client")} />
          <KPI icon={Handshake}    label="Total signés"          value={stats.totalSignes}  color={SU}      onClick={() => ouvrirModal("Dossiers signés", stats._c.filter(x => x.date_signature), "client")} />
          <KPI icon={Wallet}       label="Budget total signé"    value={stats.sommeBudgets > 0 ? fmt(stats.sommeBudgets) + " €" : "—"} color="#FFC200" disabled />
          <KPI icon={AlertTriangle} label="Sans prochaine action" value={stats.sansProchaineAction} color={DA} onClick={() => ouvrirModal("Sans prochaine action", stats._c.filter(x => !x.prochaine_action), "client")} />
        </div>

        {/* ── BIENS ── */}
        <SecTitle icon={Building2} label="Stock de Biens" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: SPACING.md, marginBottom: SPACING.xxl - 2 }}>
          <KPI icon={Home}     label="Biens en stock"       value={stats.biensTotaux}       color="#4db8ff" disabled />
          <KPI icon={Bell}     label="À relancer"           value={stats.biensARelancer}     color={DA}      onClick={() => ouvrirModal("Biens à relancer", stats._b.filter(x => x.date_relance && x.date_relance <= todayStr), "bien")} />
          <KPI icon={Calendar} label="Visites programmées"  value={stats.visitesProg}        color={SU}      onClick={() => ouvrirModal("Visites programmées", stats._b.filter(x => x.statut === "Visite programmée"), "bien")} />
          <KPI icon={Send}     label="Offres envoyées"      value={stats.offreEnvoyees}      color="#FFC200" onClick={() => ouvrirModal("Offres envoyées", stats._b.filter(x => x.statut === "Offre envoyée"), "bien")} />
          <KPI icon={Check}    label="Offres acceptées"     value={stats.offresAcceptees}    color={SU}      onClick={() => ouvrirModal("Offres acceptées", stats._b.filter(x => x.statut === "Offre acceptée"), "bien")} />
          <KPI icon={Hammer}   label="Propositions totales" value={stats.nbPropositions}     color="#c084fc" disabled />
        </div>

        {/* ── ACTIONS URGENTES + PLANNING ── */}
        <SecTitle icon={AlertTriangle} label="Actions & Planning de la semaine" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.lg }}>

          {/* Actions en retard / à venir */}
          <div className="inv-card">
            <div className="inv-card-hd danger" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon as={AlertTriangle} size={13} strokeWidth={2.2} />
                Actions en retard / à venir (7 j)
              </span>
              <span style={{ background: "rgba(255,255,255,.18)", color: "white", borderRadius: RADIUS.pill, padding: "1px 9px", fontSize: FONT.xs.size - 1, fontWeight: 700 }}>
                {actionsUrg.length}
              </span>
            </div>
            <div className="inv-card-bd" style={{ maxHeight: 380, overflowY: "auto", padding: `${SPACING.sm + 2}px ${SPACING.lg}px` }}>
              {actionsUrg.length === 0 ? (
                <div style={{ textAlign: "center", padding: `${SPACING.xl}px 0`, color: T.textMuted, fontStyle: "italic" }}>
                  ✅ Aucune action urgente cette semaine
                </div>
              ) : actionsUrg.map(c => {
                const enRetard = c.date_prochaine_action < todayStr;
                const auj      = c.date_prochaine_action === todayStr;
                return (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "flex-start", gap: SPACING.sm + 2,
                    padding: `${SPACING.md - 2}px 0`, borderBottom: `1px solid ${T.rowBorder}`,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 6,
                      background: enRetard ? DA : auj ? WA : SU,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: FONT.sm.size + 1, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.prenom} {c.nom}
                      </div>
                      <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.prochaine_action || "Action non précisée"}
                      </div>
                    </div>
                    <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: enRetard ? DA : auj ? WA : T.textMuted, whiteSpace: "nowrap", flexShrink: 0, textAlign: "right" }}>
                      {enRetard ? "⚠ " : auj ? "→ " : ""}{fmtDate(c.date_prochaine_action)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Planning de la semaine */}
          <div className="inv-card">
            <div className="inv-card-hd blue">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon as={Calendar} size={13} strokeWidth={2.2} />
                Planning de la semaine
              </span>
            </div>
            <div className="inv-card-bd">
              {/* Formulaire ajout event */}
              <div style={{ background: T.cardHover, borderRadius: RADIUS.md, padding: `${SPACING.md - 2}px ${SPACING.md}px`, marginBottom: SPACING.md, border: `1px solid ${T.border}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.sm, marginBottom: SPACING.sm }}>
                  <input className="inv-inp" placeholder="Titre de l'événement…" value={newEvent.titre}
                    onChange={e => setNewEvent({ ...newEvent, titre: e.target.value })}
                    onKeyDown={e => e.key === "Enter" && ajouterEvent()}
                    style={{ textAlign: "left", fontSize: FONT.sm.size, padding: "5px 9px" }} />
                  <input className="inv-inp" type="date" value={newEvent.date}
                    onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                    style={{ fontSize: FONT.sm.size, padding: "5px 9px" }} />
                </div>
                <div style={{ display: "flex", gap: SPACING.sm }}>
                  <select className="inv-sel" value={newEvent.type} onChange={e => setNewEvent({ ...newEvent, type: e.target.value })}
                    style={{ flex: 1, fontSize: FONT.sm.size, padding: "5px 9px" }}>
                    {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={ajouterEvent} disabled={savingEv || !newEvent.titre.trim()}>
                    <Icon as={Plus} size={12} strokeWidth={2.2} /> Ajouter
                  </button>
                </div>
              </div>

              {/* Liste events */}
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                {planning.length === 0 ? (
                  <div style={{ textAlign: "center", padding: `${SPACING.lg}px 0`, color: T.textMuted, fontStyle: "italic" }}>
                    Aucun événement cette semaine
                  </div>
                ) : planning.map((ev, i) => {
                  const col = EVENT_COLORS[ev.type] || T.textMuted;
                  return (
                    <div key={ev.id || i} style={{ display: "flex", alignItems: "center", gap: SPACING.sm + 2, padding: `${SPACING.sm}px 0`, borderBottom: `1px solid ${T.rowBorder}` }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: RADIUS.sm + 1, flexShrink: 0,
                        background: `${col}18`, color: col,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14,
                      }}>
                        {EVENT_ICONS[ev.type] || "📌"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: FONT.sm.size + 1, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ev.titre}
                        </div>
                        <div style={{ fontSize: FONT.xs.size + 1, color: col, fontWeight: 700 }}>{ev.type}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm, flexShrink: 0 }}>
                        <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{fmtDate(ev.date)}</span>
                        {ev.source === "manual" && (
                          <button onClick={() => supprimerEvent(ev.id)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px", transition: "color .12s" }}
                            onMouseEnter={e => e.currentTarget.style.color = DA}
                            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                            title="Supprimer">×</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </>)}

      {modal && <Modal />}
      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ─── CRM — remplace entièrement le composant CRM ─────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function CRM({ profil, T = THEMES_INV.dark, onOuvrirSimulation }) {
  const [clients,           setClients]           = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [ficheId,           setFicheId]           = useState(null);
  const [showForm,          setShowForm]           = useState(false);
  const [showFiltres,       setShowFiltres]        = useState(false);
  const [search,            setSearch]             = useState("");
  // Filtres par colonne
  const [filtreStatut,      setFiltreStatut]       = useState("");
  const [filtreConseiller,  setFiltreConseiller]   = useState("");
  const [filtreSource,      setFiltreSource]       = useState("");
  const [filtreEtape,       setFiltreEtape]        = useState("");
  const [filtreBudgetMin,   setFiltreBudgetMin]    = useState("");
  const [filtreBudgetMax,   setFiltreBudgetMax]    = useState("");
  const [filtreAvantContact,setFiltreAvantContact] = useState("");
  // Tri colonne
  const [sortCol,  setSortCol]  = useState("date_prochaine_action");
  const [sortDir,  setSortDir]  = useState("asc");

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_clients").select("*").order("created_at", { ascending: false });
    setClients(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const conseillers = [...new Set(clients.map(c => c.conseiller).filter(Boolean))];

  // Tri
  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };
  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <Icon as={ChevronDown} size={10} color="rgba(255,255,255,.3)" />;
    return sortDir === "asc"
      ? <Icon as={ChevronUp} size={11} color="white" />
      : <Icon as={ChevronDown} size={11} color="white" />;
  };

  let filtered = clients.filter(c => {
    if (filtreStatut     && c.statut    !== filtreStatut)     return false;
    if (filtreConseiller && c.conseiller !== filtreConseiller) return false;
    if (filtreSource     && c.source    !== filtreSource)     return false;
    if (filtreEtape      && c.etape     !== filtreEtape)      return false;
    if (filtreBudgetMin  && (c.budget || 0) < parseFloat(filtreBudgetMin)) return false;
    if (filtreBudgetMax  && (c.budget || 0) > parseFloat(filtreBudgetMax)) return false;
    if (filtreAvantContact && c.date_avant_contact !== filtreAvantContact) return false;
    if (search && !`${c.nom} ${c.prenom} ${c.email} ${c.telephone || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Tri dynamique
  filtered = [...filtered].sort((a, b) => {
    let va = a[sortCol] ?? "", vb = b[sortCol] ?? "";
    if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va;
    return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const hasFilters = filtreStatut || filtreConseiller || filtreSource || filtreEtape || filtreBudgetMin || filtreBudgetMax || filtreAvantContact;

  const STATUT_COLORS = { Prospect: "#4db8ff", Actif: SU, Inactif: WA, Terminé: "rgba(255,255,255,0.3)" };
  const fmtDate   = d => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";
  const fmtBudget = v => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " €" : "—";

  const ColHd = ({ label, col, style }) => (
    <div onClick={() => toggleSort(col)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", ...style }}
      title={`Trier par ${label}`}>
      {label} <SortIcon col={col} />
    </div>
  );

  if (ficheId) return <FicheClient id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} onOuvrirSimulation={onOuvrirSimulation} />;

  return (
    <div style={{ padding: `${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.xl - 4, flexWrap: "wrap", gap: SPACING.sm + 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: SPACING.md }}>
          <div style={{ width: 44, height: 44, borderRadius: RADIUS.lg, background: T.accentBg, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={Users} size={22} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: FONT.h2.size, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>CRM Clients / Prospects</div>
            <div style={{ fontSize: FONT.sm.size + 1, color: T.textSub, marginTop: 2 }}>{filtered.length} contact{filtered.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: SPACING.sm }}>
          <button className={`inv-btn inv-btn-sm ${hasFilters ? "inv-btn-accent" : "inv-btn-out"}`}
            onClick={() => setShowFiltres(f => !f)}>
            <Icon as={Filter} size={12} strokeWidth={2.2} />
            Filtres {hasFilters ? `(actifs)` : ""}
            {showFiltres ? <Icon as={ChevronUp} size={12} /> : <Icon as={ChevronDown} size={12} />}
          </button>
          <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>
            <Icon as={Plus} size={13} strokeWidth={2.2} /> Nouveau contact
          </button>
        </div>
      </div>

      {/* Barre recherche + filtres avancés */}
      <div style={{ marginBottom: SPACING.md }}>
        <div style={{ position: "relative", width: 280, marginBottom: showFiltres ? SPACING.sm + 2 : 0 }}>
          <Icon as={Search} size={13} color={T.textMuted}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input className="inv-inp" placeholder="Rechercher nom, email, tél…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", textAlign: "left", paddingLeft: 30, fontSize: FONT.sm.size + 1 }} />
        </div>

        {showFiltres && (
          <div style={{
            background: T.cardHover, borderRadius: RADIUS.lg, padding: `${SPACING.md}px ${SPACING.lg}px`,
            border: `1px solid ${T.border}`, display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: SPACING.sm + 2,
            marginTop: SPACING.sm + 2,
          }}>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Statut</div>
              <select className="inv-sel" value={filtreStatut} onChange={e => setFiltreStatut(e.target.value)} style={{ width: "100%" }}>
                <option value="">Tous</option>
                {STATUTS_CLIENT.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Conseiller</div>
              <select className="inv-sel" value={filtreConseiller} onChange={e => setFiltreConseiller(e.target.value)} style={{ width: "100%" }}>
                <option value="">Tous</option>
                {conseillers.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Source</div>
              <select className="inv-sel" value={filtreSource} onChange={e => setFiltreSource(e.target.value)} style={{ width: "100%" }}>
                <option value="">Toutes</option>
                {SOURCES_CLIENT.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Étape</div>
              <select className="inv-sel" value={filtreEtape} onChange={e => setFiltreEtape(e.target.value)} style={{ width: "100%" }}>
                <option value="">Toutes</option>
                {ETAPES_CLIENT.filter(Boolean).map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Budget min (€)</div>
              <input className="inv-inp" type="number" placeholder="0" value={filtreBudgetMin} onChange={e => setFiltreBudgetMin(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Budget max (€)</div>
              <input className="inv-inp" type="number" placeholder="∞" value={filtreBudgetMax} onChange={e => setFiltreBudgetMax(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Avant contact (date)</div>
              <input className="inv-inp" type="date" value={filtreAvantContact} onChange={e => setFiltreAvantContact(e.target.value)} style={{ width: "100%" }} />
            </div>
            {hasFilters && (
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={() => {
                  setFiltreStatut(""); setFiltreConseiller(""); setFiltreSource("");
                  setFiltreEtape(""); setFiltreBudgetMin(""); setFiltreBudgetMax(""); setFiltreAvantContact("");
                }}>
                  <Icon as={X} size={12} strokeWidth={2.2} /> Réinitialiser
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: `${SPACING.xl}px 0`, color: T.textMuted, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <Icon as={RefreshCw} size={14} style={{ animation: "spin 1s linear infinite" }} /> Chargement…
        </div>
      ) : (
        <div style={{ background: T.card, borderRadius: RADIUS.xl, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: T.shadowSm }}>
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1.3fr 1fr 1fr 80px",
            padding: `${SPACING.md - 2}px ${SPACING.lg}px`, background: T.sectionHd,
            borderBottom: `1px solid ${T.border}`, fontSize: FONT.xs.size - 1, fontWeight: 700,
            color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8,
          }}>
            <ColHd label="Contact"           col="nom" />
            <ColHd label="Statut"            col="statut" />
            <ColHd label="Budget"            col="budget" />
            <ColHd label="Conseiller"        col="conseiller" />
            <ColHd label="Étape"             col="etape" />
            <ColHd label="Avant contact"     col="date_avant_contact" />
            <ColHd label="Prochaine action"  col="date_prochaine_action" />
            <div />
          </div>

          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: `${SPACING.xl}px 0`, color: T.textMuted, fontStyle: "italic" }}>Aucun contact trouvé</div>
          ) : filtered.map(c => {
            const initials = `${c.prenom?.[0] || ""}${c.nom?.[0] || ""}`.toUpperCase();
            const enRetard = c.date_prochaine_action && c.date_prochaine_action < new Date().toISOString().slice(0, 10);
            return (
              <div key={c.id} style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1.3fr 1fr 1fr 80px",
                padding: `${SPACING.md + 2}px ${SPACING.lg}px`, borderBottom: `1px solid ${T.rowBorder}`,
                alignItems: "center", cursor: "pointer", transition: "background .12s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = T.cardHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                onClick={() => setFicheId(c.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm + 2, minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: T.accentBg, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT.sm.size, fontWeight: 800 }}>{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.prenom} {c.nom}</div>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email || c.telephone || "—"}</div>
                  </div>
                </div>
                <div>
                  <span style={{ background: `${STATUT_COLORS[c.statut]}18`, color: STATUT_COLORS[c.statut], border: `1px solid ${STATUT_COLORS[c.statut]}33`, borderRadius: RADIUS.pill, padding: `${SPACING.xs - 2}px ${SPACING.sm + 2}px`, fontSize: FONT.xs.size, fontWeight: 700 }}>{c.statut}</span>
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.sm.size + 1, fontWeight: 600, color: T.accent }}>{fmtBudget(c.budget)}</div>
                <div style={{ fontSize: FONT.sm.size + 1, color: T.textSub }}>{c.conseiller || "—"}</div>
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.etape || ""}>{c.etape || "—"}</div>
                <div style={{ fontSize: FONT.sm.size, color: T.textMuted }}>{fmtDate(c.date_avant_contact)}</div>
                <div style={{ fontSize: FONT.sm.size, color: enRetard ? DA : T.textMuted }}>
                  {enRetard && <Icon as={AlertTriangle} size={11} strokeWidth={2.2} style={{ marginRight: 3, verticalAlign: -1 }} />}
                  {fmtDate(c.date_prochaine_action)}
                  {c.prochaine_action && <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.prochaine_action.slice(0, 28)}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: FONT.sm.size, color: T.accent, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && <FormulaireClient profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
      <style>{`@keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ─── FORMULAIRE CLIENT — remplace entièrement FormulaireClient ───────────────
//  Changements : étape → dropdown ETAPES_CLIENT, + champ date_avant_contact
// ══════════════════════════════════════════════════════════════════════════════

function FormulaireClient({ client, profil, onSave, onClose, T = THEMES_INV.dark }) {
  const isEdit = !!client;
  const [form, setForm] = useState({
    nom:                   client?.nom || "",
    prenom:                client?.prenom || "",
    email:                 client?.email || "",
    telephone:             client?.telephone || "",
    conseiller:            client?.conseiller || profil?.nom || "",
    source:                client?.source || "Autre",
    statut:                client?.statut || "Prospect",
    budget:                client?.budget || 0,
    etape:                 client?.etape || "",
    date_avant_contact:    client?.date_avant_contact || "",
    prochaine_action:      client?.prochaine_action || "",
    date_prochaine_action: client?.date_prochaine_action || "",
    notes_rapides:         client?.notes_rapides || "",
  });
  const [saving, setSaving] = useState(false);

  const sauvegarder = async () => {
    if (!form.nom.trim()) return;
    setSaving(true);
    const payload = {
      nom:                   form.nom.trim(),
      prenom:                form.prenom.trim() || null,
      email:                 form.email.trim() || null,
      telephone:             form.telephone.trim() || null,
      conseiller:            form.conseiller.trim() || null,
      source:                form.source || "Autre",
      statut:                form.statut || "Prospect",
      budget:                parseFloat(form.budget) || 0,
      etape:                 form.etape || null,
      date_avant_contact:    form.date_avant_contact || null,
      prochaine_action:      form.prochaine_action.trim() || null,
      date_prochaine_action: form.date_prochaine_action || null,
      notes_rapides:         form.notes_rapides.trim() || null,
    };
    const { error } = isEdit
      ? await supabase.from("invest_clients").update(payload).eq("id", client.id)
      : await supabase.from("invest_clients").insert(payload);
    if (error) { console.error("Erreur client:", error); alert("Erreur : " + error.message); }
    setSaving(false);
    if (!error) onSave();
  };

  const LBL = ({ children }) => (
    <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 5 }}>
      {children}
    </label>
  );
  const F = { marginBottom: 14 };
  const inp = { width: "100%", textAlign: "left" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: "28px 30px", width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.text, marginBottom: 20 }}>{isEdit ? "Modifier le contact" : "Nouveau contact"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div style={F}><LBL>Nom *</LBL><input className="inv-inp" value={form.nom} style={inp} onChange={e => setForm({ ...form, nom: e.target.value })} /></div>
          <div style={F}><LBL>Prénom</LBL><input className="inv-inp" value={form.prenom} style={inp} onChange={e => setForm({ ...form, prenom: e.target.value })} /></div>
          <div style={F}><LBL>Email</LBL><input className="inv-inp" type="email" value={form.email} style={inp} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div style={F}><LBL>Téléphone</LBL><input className="inv-inp" value={form.telephone} style={inp} onChange={e => setForm({ ...form, telephone: e.target.value })} /></div>
          <div style={F}><LBL>Conseiller référent</LBL><input className="inv-inp" value={form.conseiller} style={inp} onChange={e => setForm({ ...form, conseiller: e.target.value })} /></div>
          <div style={F}><LBL>Source</LBL>
            <select className="inv-sel" value={form.source} style={{ width: "100%" }} onChange={e => setForm({ ...form, source: e.target.value })}>
              {SOURCES_CLIENT.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={F}><LBL>Statut</LBL>
            <select className="inv-sel" value={form.statut} style={{ width: "100%" }} onChange={e => setForm({ ...form, statut: e.target.value })}>
              {STATUTS_CLIENT.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={F}><LBL>Budget (€)</LBL><input className="inv-inp" type="number" value={form.budget} style={{ width: "100%" }} onChange={e => setForm({ ...form, budget: e.target.value })} /></div>
          {/* Étape — dropdown */}
          <div style={{ ...F, gridColumn: "1 / -1" }}><LBL>Étape en cours</LBL>
            <select className="inv-sel" value={form.etape} style={{ width: "100%" }} onChange={e => setForm({ ...form, etape: e.target.value })}>
              {ETAPES_CLIENT.map(e => <option key={e} value={e}>{e || "— Aucune étape —"}</option>)}
            </select>
          </div>
          {/* Date avant contact */}
          <div style={F}><LBL>Date avant contact</LBL><input className="inv-inp" type="date" value={form.date_avant_contact} style={{ width: "100%" }} onChange={e => setForm({ ...form, date_avant_contact: e.target.value })} /></div>
          <div style={F}><LBL>Date prochaine action</LBL><input className="inv-inp" type="date" value={form.date_prochaine_action} style={{ width: "100%" }} onChange={e => setForm({ ...form, date_prochaine_action: e.target.value })} /></div>
        </div>
        <div style={F}><LBL>Prochaine action</LBL><input className="inv-inp" value={form.prochaine_action} style={inp} onChange={e => setForm({ ...form, prochaine_action: e.target.value })} /></div>
        <div style={F}><LBL>Notes rapides</LBL><textarea className="inv-textarea" rows={3} value={form.notes_rapides} onChange={e => setForm({ ...form, notes_rapides: e.target.value })} /></div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button className="inv-btn inv-btn-out" onClick={onClose}>Annuler</button>
          <button className="inv-btn inv-btn-gold" onClick={sauvegarder} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ─── STOCK BIENS — remplace entièrement StockBiens ────────────────────────────
//  Changements : carte en haut, colonne statut avant "Bien", colonnes triables
// ══════════════════════════════════════════════════════════════════════════════

function StockBiens({ profil, T = THEMES_INV.dark }) {
  const [biens,        setBiens]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [ficheId,      setFicheId]      = useState(null);
  const [showForm,     setShowForm]     = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreVille,  setFiltreVille]  = useState("");
  const [search,       setSearch]       = useState("");
  const [sortCol,      setSortCol]      = useState("created_at");
  const [sortDir,      setSortDir]      = useState("desc");

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("invest_biens").select("*").order("created_at", { ascending: false });
    setBiens(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const today  = new Date().toISOString().slice(0, 10);
  const villes = [...new Set(biens.map(b => b.ville).filter(Boolean))];

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <Icon as={ChevronDown} size={10} color="rgba(255,255,255,.3)" />;
    return sortDir === "asc" ? <Icon as={ChevronUp} size={11} color="white" /> : <Icon as={ChevronDown} size={11} color="white" />;
  };

  const ColHd = ({ label, col, style }) => (
    <div onClick={() => toggleSort(col)} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none", ...style }}>
      {label} <SortIcon col={col} />
    </div>
  );

  let filtered = biens.filter(b => {
    if (filtreStatut && b.statut !== filtreStatut) return false;
    if (filtreVille  && b.ville  !== filtreVille)  return false;
    if (search && !`${b.adresse || ""} ${b.ville || ""} ${b.agence || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    let va = a[sortCol] ?? "", vb = b[sortCol] ?? "";
    if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va;
    return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const aRelancer  = biens.filter(b => b.date_relance && b.date_relance <= today).length;
  const fmtDate    = d => d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";
  const fmtEur     = v => v > 0 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " €" : "—";

  // Colonnes : 40px(statut) | 2fr(bien) | 1.2fr(statut badge) | 1fr | 1fr | 1fr | 1fr | 80px
  const COLS = "40px 2fr 1.2fr 1fr 1fr 1fr 1fr 80px";

  if (ficheId) return <FicheBien id={ficheId} profil={profil} T={T} onRetour={() => { setFicheId(null); charger(); }} />;

  return (
    <div style={{ padding: `${SPACING.xl}px ${SPACING.xl + 4}px`, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.xl - 4, flexWrap: "wrap", gap: SPACING.sm + 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: SPACING.md }}>
          <div style={{ width: 44, height: 44, borderRadius: RADIUS.lg, background: T.accentBg, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={Building2} size={22} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: FONT.h2.size, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Stock de Biens</div>
            <div style={{ fontSize: FONT.sm.size + 1, color: T.textMuted, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 8 }}>
              {filtered.length} bien{filtered.length !== 1 ? "s" : ""}
              {aRelancer > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: DA, fontWeight: 700 }}>
                  · <Icon as={Bell} size={11} strokeWidth={2.2} /> {aRelancer} à relancer
                </span>
              )}
            </div>
          </div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => setShowForm(true)}>
          <Icon as={Plus} size={13} strokeWidth={2.2} /> Nouveau bien
        </button>
      </div>

      {/* Carte */}
      <CarteStockBiens biens={filtered} T={T} />

      {/* Filtres */}
      <div style={{ display: "flex", gap: SPACING.sm + 2, marginBottom: SPACING.lg, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 240 }}>
          <Icon as={Search} size={13} color={T.textMuted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input className="inv-inp" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", textAlign: "left", paddingLeft: 30, fontSize: FONT.sm.size + 1 }} />
        </div>
        <select className="inv-sel" value={filtreStatut} onChange={e => setFiltreStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          {STATUTS_BIEN.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="inv-sel" value={filtreVille} onChange={e => setFiltreVille(e.target.value)}>
          <option value="">Toutes villes</option>
          {villes.map(v => <option key={v}>{v}</option>)}
        </select>
        <button className="inv-btn inv-btn-danger inv-btn-sm" onClick={() => { setFiltreStatut("À relancer"); setSortCol("date_relance"); setSortDir("asc"); }}>
          <Icon as={Bell} size={12} strokeWidth={2.2} /> Voir à relancer
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: `${SPACING.xl}px 0`, color: T.textMuted, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <Icon as={RefreshCw} size={14} style={{ animation: "spin 1s linear infinite" }} /> Chargement…
        </div>
      ) : (
        <div style={{ background: T.card, borderRadius: RADIUS.xl, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: T.shadowSm }}>
          {/* Header triable */}
          <div style={{
            display: "grid", gridTemplateColumns: COLS,
            padding: `${SPACING.md - 2}px ${SPACING.lg}px`, background: T.sectionHd,
            borderBottom: `1px solid ${T.border}`, fontSize: FONT.xs.size - 1, fontWeight: 700,
            color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, alignItems: "center",
          }}>
            <div /> {/* colonne indicateur couleur */}
            <ColHd label="Bien"          col="adresse" />
            <ColHd label="Statut"        col="statut" />
            <ColHd label="Coût total"    col="cout_total" />
            <ColHd label="Rendement"     col="rendement_brut" />
            <ColHd label="Cash-flow"     col="cashflow_estime" />
            <ColHd label="Relance"       col="date_relance" />
            <div />
          </div>

          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: `${SPACING.xl}px 0`, color: T.textMuted, fontStyle: "italic" }}>Aucun bien trouvé</div>
          ) : filtered.map(b => {
            const couleur = STATUT_BIEN_COLORS[b.statut] || "#9aa0b0";
            const enRelance = b.date_relance && b.date_relance <= today;
            const rendCol = b.rendement_brut >= 8 ? SU : b.rendement_brut >= 5 ? WA : T.textMuted;
            const cfVal   = b.cashflow_estime || 0;
            const cfCol   = cfVal > 0 ? SU : cfVal < 0 ? DA : T.textMuted;
            return (
              <div key={b.id} style={{
                display: "grid", gridTemplateColumns: COLS,
                padding: `${SPACING.md + 2}px ${SPACING.lg}px`, borderBottom: `1px solid ${T.rowBorder}`,
                alignItems: "center", cursor: "pointer", transition: "background .12s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = T.cardHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                onClick={() => setFicheId(b.id)}>
                {/* Indicateur couleur statut */}
                <div title={b.statut} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: couleur, boxShadow: `0 0 6px ${couleur}80`, flexShrink: 0 }} />
                </div>
                {/* Bien */}
                <div style={{ display: "flex", alignItems: "center", gap: SPACING.sm + 2, minWidth: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: RADIUS.md, flexShrink: 0, background: `${couleur}22`, color: couleur, border: `1px solid ${couleur}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon as={Home} size={17} strokeWidth={2} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.adresse || "Adresse non renseignée"}</div>
                    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {b.ville && <><Icon as={MapPin} size={10} /> {b.ville}</>}
                      {b.agence && <span> · {b.agence}</span>}
                    </div>
                  </div>
                </div>
                {/* Statut badge */}
                <div>
                  <span style={{ background: `${couleur}18`, color: couleur, border: `1px solid ${couleur}33`, borderRadius: RADIUS.pill, padding: `${SPACING.xs - 2}px ${SPACING.sm + 1}px`, fontSize: FONT.xs.size - 1, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {b.statut}
                  </span>
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.sm.size, fontWeight: 600, color: T.textSub }}>{fmtEur(b.cout_total)}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.sm.size + 1, fontWeight: 700, color: rendCol }}>{b.rendement_brut > 0 ? b.rendement_brut.toFixed(1) + "%" : "—"}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: FONT.sm.size, color: cfCol, fontWeight: cfVal !== 0 ? 600 : 400 }}>{b.cashflow_estime ? fmtEur(b.cashflow_estime) + "/mois" : "—"}</div>
                <div style={{ fontSize: FONT.sm.size, color: enRelance ? DA : T.textMuted, fontWeight: enRelance ? 700 : 400, display: "inline-flex", alignItems: "center", gap: 3 }}>
                  {enRelance && <Icon as={Bell} size={11} strokeWidth={2.2} />}
                  {fmtDate(b.date_relance)}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: FONT.sm.size, color: T.accent, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Ouvrir <Icon as={ChevronRight} size={12} strokeWidth={2.5} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && <FormulaireBien profil={profil} T={T} onSave={() => { setShowForm(false); charger(); }} onClose={() => setShowForm(false)} />}
      <style>{`@keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}
