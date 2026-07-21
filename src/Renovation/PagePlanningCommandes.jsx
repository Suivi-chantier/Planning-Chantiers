import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots } from "../constants";
import { Icon } from "../ui";
import {
  ShoppingCart, Package, Calendar, Check, AlertTriangle, Building2,
  ArrowRight, Info, X, Mail, Plus, Trash2, Copy, ChevronLeft,
  ChevronRight, Send, Receipt, Boxes, CheckCircle2, CalendarClock,
  User, Inbox, ExternalLink,
} from "lucide-react";

// ─── HELPERS DATES ───────────────────────────────────────────────────────────
// Lundi (00:00) de la semaine contenant `d`. ISO : lundi = début de semaine.
function lundiSemaine(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Dim ... 6=Sam
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtJourMois(d) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function fmtDateLongue(d) {
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
function numeroSemaine(d) {
  // ISO week number
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
}

// Hook simple de détection mobile (drill-down master/detail sur petit écran).
function useIsMobile(maxWidth = 860) {
  const q = `(max-width: ${maxWidth}px)`;
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = (e) => setM(e.matches);
    mq.addEventListener ? mq.addEventListener("change", h) : mq.addListener(h);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", h) : mq.removeListener(h); };
  }, [q]);
  return m;
}

// ─── PAGE PRINCIPALE ─────────────────────────────────────────────────────────
export default function PagePlanningCommandes({ chantiers = [], T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const isMobile = useIsMobile();

  const [lots, setLots]           = useState(LOTS_DEFAUT);
  const [materiaux, setMateriaux] = useState([]); // biblio : valorise les materiaux_liens
  const [phasages, setPhasages]   = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [lignesCmd, setLignesCmd] = useState([]); // commande_lignes existantes (+ en-tête commande)
  const [besoins, setBesoins]     = useState([]); // demandes ouvrier en attente (table besoins)
  const [loading, setLoading]     = useState(true);

  // Vue courante : "ouvrage" (backlog phasage) | "demandes" (paniers ouvrier)
  const [vue, setVue] = useState("ouvrage");

  // Sélection master/detail
  const [selChantierId, setSelChantierId] = useState(null);
  const [selOuvrageId, setSelOuvrageId]   = useState(null);

  // Modales
  const [cmdModal, setCmdModal]     = useState(null); // { titre, lignes, dateBesoin }
  const [vendrediOpen, setVendrediOpen] = useState(false);

  // Couleurs harmonisées avec le reste de l'app
  const bg        = T?.bg        || "#1e2128";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // ── Chargements
  const loadPhasages = async () => {
    const { data } = await supabase
      .from("phasages")
      .select("id, chantier_id, chantier_nom, ouvrages");
    setPhasages(data || []);
  };
  const loadLignesCmd = async () => {
    const { data } = await supabase
      .from("commande_lignes")
      .select("id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, chantier_id, phasage_id, commande:commandes(id, doc_numero, numero_en_attente, date_doc, fournisseur_nom, statut_completude, statut_facturation, type_evenement)");
    setLignesCmd(data || []);
  };
  const loadBesoins = async () => {
    const { data } = await supabase
      .from("besoins")
      .select("id, panier_id, chantier_id, materiau_id, article, quantite, ouvrier_demandeur, notes, priorite, photo_url, created_at")
      .eq("statut", "en_attente")
      .order("created_at", { ascending: false });
    setBesoins(data || []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadPhasages(), loadLignesCmd(), loadBesoins()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    supabase.from("fournisseurs")
      .select("id, nom, email, mail_type")
      .order("nom")
      .then(({ data }) => setFournisseurs(data || []));
    loadLots().then(setLots);
    supabase.from("materiaux_bibliotheque")
      .select("id, nom, reference, unite, prix_unitaire, fournisseur, fournisseur_id, lien_fournisseur, photo_url")
      .then(({ data }) => setMateriaux(data || []));
  }, []);

  // Appelé après une commande passée. AUCUNE écriture dans commandes ici : la
  // page sert de suivi visuel + envoi des mails, la commande réelle est saisie
  // à réception (page Saisie commande). On pose juste un flag commande_le sur
  // les materiaux_liens du phasage pour retirer les articles du "à commander".
  const marquerCommande = async (lignesPassees) => {
    const parPhasage = new Map();
    (lignesPassees || []).forEach(l => {
      if (!l.phasageId || !l.ouvrageId || l.materiau_id == null) return;
      if (!parPhasage.has(l.phasageId)) parPhasage.set(l.phasageId, []);
      parPhasage.get(l.phasageId).push(l);
    });
    const dateISO = new Date().toISOString().slice(0, 10);
    for (const [phasageId, ls] of parPhasage) {
      // Relit la version fraîche du phasage pour ne pas écraser des modifs concurrentes.
      const { data: frais } = await supabase.from("phasages").select("ouvrages").eq("id", phasageId).single();
      const base = Array.isArray(frais?.ouvrages) ? frais.ouvrages : null;
      if (!base) continue;
      const ouvrages = base.map(o => {
        const lsO = ls.filter(l => l.ouvrageId === o.id);
        if (lsO.length === 0) return o;
        return {
          ...o,
          materiaux_liens: (o.materiaux_liens || []).map(ml =>
            lsO.some(l => String(l.materiau_id) === String(ml.materiau_id)) ? { ...ml, commande_le: dateISO } : ml
          ),
        };
      });
      await supabase.from("phasages").update({ ouvrages }).eq("id", phasageId);
    }
    await loadPhasages();
  };
  const onCommandePassee = async (lignesPassees) => {
    await marquerCommande(lignesPassees);
    setCmdModal(null);
    setVendrediOpen(false);
  };
  // Annule le marquage "commandé" d'un matériau : il revient dans "à commander".
  const annulerMarque = async (chantier, ouvrage, materiauId) => {
    const { data: frais } = await supabase.from("phasages").select("ouvrages").eq("id", chantier.phasageId).single();
    const base = Array.isArray(frais?.ouvrages) ? frais.ouvrages : null;
    if (!base) return;
    const ouvrages = base.map(o => o.id !== ouvrage.id ? o : ({
      ...o,
      materiaux_liens: (o.materiaux_liens || []).map(ml =>
        String(ml.materiau_id) === String(materiauId) ? (({ commande_le, ...rest }) => rest)(ml) : ml
      ),
    }));
    await supabase.from("phasages").update({ ouvrages }).eq("id", chantier.phasageId);
    await loadPhasages();
  };

  // Index biblio par id (string-safe)
  const matById = useMemo(() => {
    const m = {};
    materiaux.forEach(x => { m[String(x.id)] = x; });
    return m;
  }, [materiaux]);

  const lotById = useMemo(() => {
    const m = {};
    lots.forEach(l => { m[l.id] = l; });
    return m;
  }, [lots]);

  // Lignes de commande indexées par ouvrage (par ouvrage_id, repli sur matériau).
  const lignesParOuvrage = useMemo(() => {
    // Map ouvrageId -> [lignes]
    const direct = {};
    lignesCmd.forEach(l => {
      if (l.ouvrage_id) (direct[l.ouvrage_id] = direct[l.ouvrage_id] || []).push(l);
    });
    return direct;
  }, [lignesCmd]);

  // ── Construit le modèle Chantier → Ouvrage avec "à commander" / "déjà commandé".
  const modele = useMemo(() => {
    const result = [];
    phasages.forEach(p => {
      const ouvragesRaw = Array.isArray(p.ouvrages) ? p.ouvrages : [];
      if (ouvragesRaw.length === 0) return;
      const chantier = chantiers.find(c => c.id === p.chantier_id);
      const chantierNom = chantier?.nom || p.chantier_nom || "(sans chantier)";
      const chantierCouleur = chantier?.couleur || "#888";

      const ouvrages = [];
      ouvragesRaw.forEach(o => {
        // Matériaux prévus (depuis materiaux_liens, valorisés via la biblio)
        const prevus = (o.materiaux_liens || [])
          .filter(ml => ml && ml.materiau_id != null)
          .map(ml => {
            const mat = matById[String(ml.materiau_id)];
            if (!mat) return null;
            return {
              materiau_id:     ml.materiau_id,
              libelle:         mat.nom || "",
              quantite:        ml.quantite != null ? ml.quantite : 1,
              unite:           mat.unite || "U",
              prix_ht:         parseFloat(mat.prix_unitaire) || 0,
              fournisseur_id:  mat.fournisseur_id || null,
              fournisseur_nom: mat.fournisseur || "",
              commande_le:     ml.commande_le || null,
            };
          })
          .filter(Boolean);

        // Lignes déjà commandées rattachées à cet ouvrage (par ouvrage_id, repli matériau)
        const lignesO = lignesCmd.filter(l =>
          l.ouvrage_id === o.id ||
          (!l.ouvrage_id && l.materiau_id && (o.materiaux_liens || []).some(ml => String(ml.materiau_id) === String(l.materiau_id) && l.chantier_id === p.chantier_id))
        );
        const matCommandes = new Set(lignesO.map(l => l.materiau_id != null ? String(l.materiau_id) : null).filter(Boolean));

        // À commander = prévus sans ligne de commande saisie NI flag commande_le
        // (posé par « Passer commande » — la saisie réelle se fait à réception).
        const aCommander = prevus.filter(pr => !matCommandes.has(String(pr.materiau_id)) && !pr.commande_le);
        // Marqués commandés via la page, en attente de la saisie réelle.
        const marques = prevus.filter(pr => pr.commande_le && !matCommandes.has(String(pr.materiau_id)));

        // Date de besoin = date_prevue la plus proche parmi les tâches de l'ouvrage
        let earliest = null;
        (o.taches || []).forEach(t => {
          if (t.date_prevue && (!earliest || t.date_prevue < earliest)) earliest = t.date_prevue;
        });

        if (prevus.length === 0 && lignesO.length === 0) return; // ouvrage sans matériau ni commande : ignoré

        ouvrages.push({
          id:            o.id,
          libelle:       o.libelle || o.nom || "Ouvrage",
          lotId:         o.lot_id || null,
          lotLabel:      lotById[o.lot_id]?.label || "Sans lot",
          lotCouleur:    lotById[o.lot_id]?.couleur || "#888",
          prevus,
          aCommander,
          marques,
          lignesCmd:     lignesO,
          dateISO:       earliest,
          dateObj:       earliest ? new Date(earliest) : null,
        });
      });

      if (ouvrages.length === 0) return;
      // tri ouvrages : par lot puis libellé
      ouvrages.sort((a, b) => (a.lotLabel || "").localeCompare(b.lotLabel || "") || (a.libelle || "").localeCompare(b.libelle || ""));

      const nbACommander = ouvrages.reduce((s, o) => s + o.aCommander.length, 0);
      const totalACommander = ouvrages.reduce((s, o) =>
        s + o.aCommander.reduce((ss, m) => ss + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0), 0);

      result.push({
        phasageId:   p.id,
        chantierId:  p.chantier_id,
        chantierNom,
        chantierCouleur,
        ouvrages,
        nbACommander,
        totalACommander,
      });
    });
    // tri chantiers : ceux avec des articles à commander d'abord, puis par nom
    result.sort((a, b) => (b.nbACommander - a.nbACommander) || a.chantierNom.localeCompare(b.chantierNom));
    return result;
  }, [phasages, chantiers, matById, lotById, lignesCmd]);

  // Sélection courante
  const chantierSel = modele.find(c => c.chantierId === selChantierId) || null;
  const ouvrageSel  = chantierSel?.ouvrages.find(o => o.id === selOuvrageId) || null;

  // Stats globales
  const stats = useMemo(() => {
    const nbChantiers = modele.length;
    const nbACommander = modele.reduce((s, c) => s + c.nbACommander, 0);
    const totalHt = modele.reduce((s, c) => s + c.totalACommander, 0);
    return { nbChantiers, nbACommander, totalHt };
  }, [modele]);

  // ── Construit la liste plate de TOUS les articles à commander (bouton vendredi)
  const lignesGlobalesACommander = useMemo(() => {
    const out = [];
    modele.forEach(c => {
      c.ouvrages.forEach(o => {
        o.aCommander.forEach(m => {
          out.push({
            ...m,
            chantierId:      c.chantierId,
            chantierNom:     c.chantierNom,
            chantierCouleur: c.chantierCouleur,
            phasageId:       c.phasageId,
            lotId:           o.lotId,
            lotLabel:        o.lotLabel,
            ouvrageId:       o.id,
            ouvrageLibelle:  o.libelle,
            dateISO:         o.dateISO,
            dateObj:         o.dateObj,
          });
        });
      });
    });
    return out;
  }, [modele]);

  const aucunChantier = !loading && modele.length === 0;

  // ── Demandes ouvrier regroupées par panier (un envoi = un panier_id)
  const paniers = useMemo(() => {
    const map = new Map();
    besoins.forEach(b => {
      const key = b.panier_id || ("solo_" + b.id); // repli pour les demandes legacy
      if (!map.has(key)) {
        const chantier = chantiers.find(c => c.id === b.chantier_id);
        map.set(key, {
          panierId:        key,
          chantierId:      b.chantier_id,
          chantierNom:     chantier?.nom || b.chantier_id || "(sans chantier)",
          chantierCouleur: chantier?.couleur || "#888",
          ouvrier:         b.ouvrier_demandeur || "",
          priorite:        "normal",
          dateObj:         b.created_at ? new Date(b.created_at) : null,
          articles:        [],
        });
      }
      const p = map.get(key);
      // Enrichissement via la bibliothèque : image produit + lien fournisseur.
      const mat = b.materiau_id != null ? matById[String(b.materiau_id)] : null;
      const lien = mat?.lien_fournisseur?.trim() || null;
      // Repli : recherche web sur le libellé si aucun lien fournisseur connu.
      const lienFinal = lien || (b.article
        ? "https://www.google.com/search?q=" + encodeURIComponent(b.article + (mat?.fournisseur ? " " + mat.fournisseur : ""))
        : null);
      p.articles.push({
        ...b,
        image:      mat?.photo_url || b.photo_url || null,
        lien:       lienFinal,
        lienDirect: !!lien, // true = lien fournisseur réel, false = recherche web
      });
      if (b.priorite === "urgent") p.priorite = "urgent"; // urgent si au moins un article urgent
    });
    return Array.from(map.values())
      .sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
  }, [besoins, chantiers, matById]);

  // Valider tout le panier → besoins passent "traité" (ils reviendront via le scan du BL/reçu).
  const validerPanier = async (panier) => {
    const ids = panier.articles.map(a => a.id);
    const { error } = await supabase.from("besoins").update({ statut: "traite" }).in("id", ids);
    if (error) { alert("Erreur : " + error.message); return; }
    setBesoins(prev => prev.filter(b => !ids.includes(b.id)));
  };
  // Refuser tout le panier → besoins passent "annulé".
  const refuserPanier = async (panier) => {
    if (!window.confirm(`Refuser cette demande de ${panier.ouvrier || "l'ouvrier"} ? Elle sera archivée.`)) return;
    const ids = panier.articles.map(a => a.id);
    const { error } = await supabase.from("besoins").update({ statut: "annule" }).in("id", ids);
    if (error) { alert("Erreur : " + error.message); return; }
    setBesoins(prev => prev.filter(b => !ids.includes(b.id)));
  };
  // Retirer un seul article du panier (annulé individuellement).
  const retirerArticle = async (article) => {
    const { error } = await supabase.from("besoins").update({ statut: "annule" }).eq("id", article.id);
    if (error) { alert("Erreur : " + error.message); return; }
    setBesoins(prev => prev.filter(b => b.id !== article.id));
  };

  // Ouvre la modale de commande pour un ouvrage donné
  const commanderOuvrage = (chantier, ouvrage) => {
    const lignes = ouvrage.aCommander.map(m => ({
      libelle: m.libelle, quantite: m.quantite, unite: m.unite, prix_ht: m.prix_ht,
      fournisseur_id: m.fournisseur_id, fournisseur_nom: m.fournisseur_nom, materiau_id: m.materiau_id,
      chantierId: chantier.chantierId, chantierNom: chantier.chantierNom, chantierCouleur: chantier.chantierCouleur,
      phasageId: chantier.phasageId, lotId: ouvrage.lotId, lotLabel: ouvrage.lotLabel,
      ouvrageId: ouvrage.id, ouvrageLibelle: ouvrage.libelle,
    }));
    setCmdModal({
      titre: `${chantier.chantierNom} · ${ouvrage.libelle}`,
      lignes,
      dateBesoin: ouvrage.dateISO || "",
    });
  };

  // Affichage panes (drill-down sur mobile)
  const showChantiers = !isMobile || !selChantierId;
  const showOuvrages  = !isMobile || (selChantierId && !selOuvrageId);
  const showDetail    = !isMobile || !!selOuvrageId;

  return (
    <div className="page-padding pgc-page" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: bg }}>
      <style>{`
        .pgc-page .pgc-cols { display: grid; grid-template-columns: 260px 320px 1fr; gap: 14px; align-items: start; }
        .pgc-page .pgc-pane { background: ${surface}; border: 1px solid ${border}; border-radius: ${RADIUS.lg}px; overflow: hidden; display: flex; flex-direction: column; }
        .pgc-page .pgc-list { max-height: calc(100vh - 230px); overflow-y: auto; }
        .pgc-page .pgc-item { width: 100%; text-align: left; background: transparent; border: none; border-bottom: 1px solid ${border}; padding: 11px 13px; cursor: pointer; color: ${text}; font-family: inherit; transition: background .12s; display: flex; flex-direction: column; gap: 3px; }
        .pgc-page .pgc-item:hover { background: ${card}; }
        .pgc-page .pgc-item.sel { background: ${acc.bg10}; box-shadow: inset 3px 0 0 ${acc.accent}; }
        @media (max-width: 860px) {
          .pgc-page { padding: 14px 12px !important; }
          .pgc-page .pgc-cols { display: block; }
          .pgc-page .pgc-pane { margin-bottom: 12px; }
          .pgc-page .pgc-list { max-height: none; }
          .pgc-page h1 { font-size: 18px !important; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{
          width: 36, height: 36, borderRadius: RADIUS.md, flexShrink: 0,
          background: acc.bg10, color: acc.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={ShoppingCart} size={20} strokeWidth={2}/>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: text, letterSpacing: -0.3, margin: 0 }}>
            Commandes
          </h1>
          <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 3 }}>
            Par chantier et par ouvrage — articles à commander et commandes déjà passées.
          </div>
        </div>
        {/* Bouton "commande du vendredi" */}
        {!loading && vue === "ouvrage" && stats.nbACommander > 0 && (
          <button onClick={() => setVendrediOpen(true)} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: acc.accent, color: "#1a1a1a", border: "none",
            borderRadius: RADIUS.md, padding: "10px 16px",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            boxShadow: `0 6px 18px ${acc.accent}40`,
          }}>
            <Icon as={CalendarClock} size={16}/>
            Commandes de la semaine
            <span style={{ background: "rgba(0,0,0,0.18)", borderRadius: RADIUS.pill, padding: "1px 8px", fontSize: 12 }}>
              {stats.nbACommander}
            </span>
          </button>
        )}
      </div>

      {/* ── ONGLETS : Par ouvrage / Demandes ouvriers ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { id: "ouvrage",  label: "Par ouvrage", badge: null },
          { id: "demandes", label: "Demandes ouvriers", badge: paniers.length },
        ].map(t => {
          const actif = vue === t.id;
          return (
            <button key={t.id} onClick={() => setVue(t.id)} style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              background: actif ? acc.accent : surface, color: actif ? "#1a1a1a" : textSub,
              border: `1px solid ${actif ? acc.accent : border}`, borderRadius: RADIUS.md,
              padding: "8px 15px", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
              cursor: "pointer",
            }}>
              <Icon as={t.id === "demandes" ? Inbox : Boxes} size={15}/>
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{
                  background: actif ? "rgba(0,0,0,0.18)" : acc.bg10, color: actif ? "#1a1a1a" : acc.accent,
                  borderRadius: RADIUS.pill, padding: "1px 8px", fontSize: 12, fontWeight: 800,
                }}>{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── STATS ── */}
      {!loading && vue === "ouvrage" && modele.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Chantiers en cours", val: stats.nbChantiers, color: text, icon: Building2 },
            { label: "Articles à commander", val: stats.nbACommander, color: acc.accent, icon: Package },
            { label: "Estimé HT à commander", val: `${stats.totalHt.toFixed(0)} €`, color: "#22c55e", icon: ShoppingCart },
          ].map(s => (
            <div key={s.label} style={{
              flex: "1 1 160px",
              background: surface, border: `1px solid ${border}`,
              borderRadius: RADIUS.lg, padding: "11px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
                background: s.color + "18", color: s.color,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={s.icon} size={16}/>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: s.color, letterSpacing: -.4, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CONTENU ── */}
      {vue === "demandes" ? (
        <VueDemandes
          paniers={paniers} loading={loading}
          onValider={validerPanier} onRefuser={refuserPanier} onRetirerArticle={retirerArticle}
          T={T} acc={acc}
        />
      ) : loading ? (
        <div style={{ textAlign: "center", color: textMuted, padding: 80, fontSize: FONT.base.size }}>
          Chargement…
        </div>
      ) : aucunChantier ? (
        <EmptyState T={T} acc={acc}/>
      ) : (
        <div className="pgc-cols">
          {/* ── PANE 1 : CHANTIERS ── */}
          {showChantiers && (
            <div className="pgc-pane">
              <PaneHeader icon={Building2} titre="Chantiers" sousTitre={`${modele.length}`} textMuted={textMuted} text={text} border={border} card={card}/>
              <div className="pgc-list">
                {modele.map(c => (
                  <button key={c.chantierId} className={"pgc-item" + (c.chantierId === selChantierId ? " sel" : "")}
                    onClick={() => { setSelChantierId(c.chantierId); setSelOuvrageId(null); }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: FONT.sm.size + 1, fontWeight: 700, color: text }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.chantierCouleur, flexShrink: 0 }}/>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.chantierNom}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.xs.size, color: textMuted, paddingLeft: 15 }}>
                      <span>{c.ouvrages.length} ouvrage{c.ouvrages.length > 1 ? "s" : ""}</span>
                      {c.nbACommander > 0 && (
                        <span style={{ color: acc.accent, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Icon as={Package} size={10}/> {c.nbACommander} à commander
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── PANE 2 : OUVRAGES ── */}
          {showOuvrages && (
            <div className="pgc-pane">
              {chantierSel ? (
                <>
                  <PaneHeader icon={Boxes} titre={isMobile ? null : "Ouvrages"}
                    titreNode={isMobile ? (
                      <button onClick={() => setSelChantierId(null)} style={backBtnStyle(text, border)}>
                        <Icon as={ChevronLeft} size={14}/> {chantierSel.chantierNom}
                      </button>
                    ) : null}
                    sousTitre={`${chantierSel.ouvrages.length}`} textMuted={textMuted} text={text} border={border} card={card}/>
                  <div className="pgc-list">
                    {chantierSel.ouvrages.map(o => (
                      <button key={o.id} className={"pgc-item" + (o.id === selOuvrageId ? " sel" : "")}
                        onClick={() => setSelOuvrageId(o.id)}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.libelle}</span>
                          <Icon as={ChevronRight} size={13} color={textMuted}/>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: o.lotCouleur, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <span style={{ color: o.lotCouleur }}>●</span>{o.lotLabel}
                          </span>
                          {o.aCommander.length > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: acc.accent, background: acc.bg10, borderRadius: RADIUS.pill, padding: "1px 7px" }}>
                              {o.aCommander.length} à commander
                            </span>
                          )}
                          {o.marques.length > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.12)", borderRadius: RADIUS.pill, padding: "1px 7px" }}>
                              {o.marques.length} commandé{o.marques.length > 1 ? "s" : ""} · à saisir
                            </span>
                          )}
                          {o.lignesCmd.length > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,0.12)", borderRadius: RADIUS.pill, padding: "1px 7px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <Icon as={Check} size={9}/> {o.lignesCmd.length} commandé{o.lignesCmd.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <PanePlaceholder icon={Boxes} texte="Sélectionne un chantier" textMuted={textMuted}/>
              )}
            </div>
          )}

          {/* ── PANE 3 : DÉTAIL OUVRAGE ── */}
          {showDetail && (
            <div className="pgc-pane">
              {ouvrageSel && chantierSel ? (
                <OuvrageDetail
                  chantier={chantierSel} ouvrage={ouvrageSel}
                  onBack={isMobile ? () => setSelOuvrageId(null) : null}
                  onCommander={() => commanderOuvrage(chantierSel, ouvrageSel)}
                  onAnnulerMarque={(materiauId) => annulerMarque(chantierSel, ouvrageSel, materiauId)}
                  fournisseurs={fournisseurs}
                  T={T} acc={acc}
                />
              ) : (
                <PanePlaceholder icon={Receipt} texte="Sélectionne un ouvrage pour voir ses commandes" textMuted={textMuted}/>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modale "passer commande" (générique : liste de lignes ventilées) */}
      {cmdModal && (
        <ModaleCommande
          titre={cmdModal.titre}
          lignesInit={cmdModal.lignes}
          dateBesoinInit={cmdModal.dateBesoin}
          fournisseurs={fournisseurs}
          materiaux={materiaux}
          onClose={() => setCmdModal(null)}
          onSuccess={onCommandePassee}
          T={T} acc={acc}
        />
      )}

      {/* Modale "commandes de la semaine" (onglets par semaine) */}
      {vendrediOpen && (
        <ModaleVendredi
          lignes={lignesGlobalesACommander}
          onClose={() => setVendrediOpen(false)}
          onCommander={(lignes, titre, dateBesoin) => { setVendrediOpen(false); setCmdModal({ titre, lignes, dateBesoin }); }}
          T={T} acc={acc}
        />
      )}
    </div>
  );
}

// ─── EN-TÊTE DE PANE ─────────────────────────────────────────────────────────
function PaneHeader({ icon, titre, titreNode, sousTitre, textMuted, text, border, card }) {
  return (
    <div style={{ padding: "11px 13px", borderBottom: `1px solid ${border}`, background: card, display: "flex", alignItems: "center", gap: 8 }}>
      <Icon as={icon} size={14} color={textMuted}/>
      {titreNode || (
        <div style={{ flex: 1, fontSize: FONT.xs.size + 1, fontWeight: 700, color: text, textTransform: "uppercase", letterSpacing: .8 }}>{titre}</div>
      )}
      {sousTitre != null && <span style={{ fontSize: 11, color: textMuted, fontWeight: 700 }}>{sousTitre}</span>}
    </div>
  );
}

function PanePlaceholder({ icon, texte, textMuted }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: textMuted, fontSize: FONT.sm.size + 1 }}>
      <Icon as={icon} size={26} strokeWidth={1.5} style={{ opacity: .5, marginBottom: 10 }}/>
      <div>{texte}</div>
    </div>
  );
}

function backBtnStyle(text, border) {
  return {
    display: "inline-flex", alignItems: "center", gap: 5,
    background: "transparent", border: `1px solid ${border}`, borderRadius: RADIUS.sm,
    padding: "4px 9px", color: text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
  };
}

// ─── DÉTAIL OUVRAGE : à commander + déjà commandé ────────────────────────────
function OuvrageDetail({ chantier, ouvrage, onBack, onCommander, onAnnulerMarque, T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";

  const totalACommander = ouvrage.aCommander.reduce((s, m) => s + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0);
  const dateFmt = ouvrage.dateObj ? fmtDateLongue(ouvrage.dateObj) : null;

  // Regroupe les lignes déjà commandées par commande (document)
  const cmdGroupes = useMemo(() => {
    const map = new Map();
    ouvrage.lignesCmd.forEach(l => {
      const key = l.commande?.id || "_orphelin_" + l.id;
      if (!map.has(key)) map.set(key, { commande: l.commande, lignes: [] });
      map.get(key).lignes.push(l);
    });
    return Array.from(map.values());
  }, [ouvrage.lignesCmd]);

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 230px)", overflowY: "auto" }}>
      {/* En-tête */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${border}`, background: card }}>
        {onBack && (
          <button onClick={onBack} style={{ ...backBtnStyle(text, border), marginBottom: 8 }}>
            <Icon as={ChevronLeft} size={14}/> Retour
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, marginBottom: 4 }}>
          <Icon as={Building2} size={11} color={chantier.chantierCouleur}/> {chantier.chantierNom}
          <span style={{ color: ouvrage.lotCouleur, marginLeft: 4 }}>● {ouvrage.lotLabel}</span>
        </div>
        <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, letterSpacing: -.2 }}>{ouvrage.libelle}</div>
        {dateFmt && (
          <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
            <Icon as={Calendar} size={11}/> Besoin estimé : {dateFmt}
          </div>
        )}
      </div>

      {/* À COMMANDER */}
      <div style={{ padding: "14px 16px" }}>
        <SectionTitre icon={Package} titre="À commander" compteur={ouvrage.aCommander.length} couleur={acc.accent} textMuted={textMuted}/>
        {ouvrage.aCommander.length === 0 ? (
          <div style={{ padding: "12px 0", color: textMuted, fontSize: FONT.sm.size + 1, fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon as={CheckCircle2} size={14} color="#22c55e"/> Tout est commandé pour cet ouvrage.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {ouvrage.aCommander.map((m, i) => (
                <div key={(m.materiau_id ?? "x") + "_" + i} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 11px",
                  background: card, border: `1px solid ${border}`, borderRadius: RADIUS.md,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 600, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.libelle}</div>
                    <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 1 }}>
                      {m.quantite} {m.unite}
                      {m.fournisseur_nom && <span> · {m.fournisseur_nom}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                    {((parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0)).toFixed(2)} €
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.sm.size, color: textMuted }}>
                Total estimé : <strong style={{ color: text }}>{totalACommander.toFixed(2)} € HT</strong>
              </span>
              <button onClick={onCommander} style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                background: acc.accent, color: "#1a1a1a", border: "none",
                borderRadius: RADIUS.md, padding: "9px 16px",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              }}>
                <Icon as={ShoppingCart} size={14}/> Commander ces articles
              </button>
            </div>
          </>
        )}
      </div>

      {/* COMMANDÉ — EN ATTENTE DE SAISIE (flag posé par « Passer commande ») */}
      {(ouvrage.marques || []).length > 0 && (
        <div style={{ padding: "4px 16px 14px" }}>
          <SectionTitre icon={CalendarClock} titre="Commandé · à saisir à réception" compteur={ouvrage.marques.length} couleur="#f59e0b" textMuted={textMuted}/>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {ouvrage.marques.map((m, i) => (
              <div key={(m.materiau_id ?? "x") + "_" + i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 11px",
                background: card, border: `1px solid rgba(245,158,11,0.25)`, borderRadius: RADIUS.md,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 600, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.libelle}</div>
                  <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 1 }}>
                    {m.quantite} {m.unite}
                    {m.fournisseur_nom && <span> · {m.fournisseur_nom}</span>}
                    <span> · commandé le {new Date(m.commande_le).toLocaleDateString("fr-FR")}</span>
                  </div>
                </div>
                <button onClick={() => onAnnulerMarque?.(m.materiau_id)} title="Remettre dans « à commander »" style={{
                  background: "transparent", border: `1px solid ${border}`, borderRadius: RADIUS.sm,
                  color: textMuted, cursor: "pointer", padding: "4px 8px", fontFamily: "inherit",
                  fontSize: FONT.xs.size, fontWeight: 600, flexShrink: 0,
                }}>
                  Remettre à commander
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: FONT.xs.size, color: textMuted, fontStyle: "italic" }}>
            Aucun coût compté : la commande réelle sera saisie à réception via la page Saisie commande.
          </div>
        </div>
      )}

      {/* DÉJÀ COMMANDÉ */}
      <div style={{ padding: "4px 16px 18px" }}>
        <SectionTitre icon={Receipt} titre="Déjà commandé" compteur={cmdGroupes.length} couleur="#22c55e" textMuted={textMuted}/>
        {cmdGroupes.length === 0 ? (
          <div style={{ padding: "12px 0", color: textMuted, fontSize: FONT.sm.size + 1, fontStyle: "italic" }}>
            Aucune commande passée pour cet ouvrage.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {cmdGroupes.map((g, gi) => {
              const c = g.commande || {};
              const total = g.lignes.reduce((s, l) => s + (parseFloat(l.prix_total) || 0), 0);
              const numero = c.doc_numero || (c.numero_en_attente ? "N° en attente" : "—");
              const dateDoc = c.date_doc ? new Date(c.date_doc).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null;
              return (
                <div key={gi} style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
                  <div style={{ padding: "9px 12px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Icon as={Mail} size={12} color={textMuted}/>
                    <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text }}>{c.fournisseur_nom || "Sans fournisseur"}</span>
                    <span style={{ fontSize: FONT.xs.size, color: textMuted }}>· {numero}</span>
                    {dateDoc && <span style={{ fontSize: FONT.xs.size, color: textMuted }}>· {dateDoc}</span>}
                    <span style={{ marginLeft: "auto", fontSize: FONT.sm.size, fontWeight: 800, color: text, fontFamily: "'DM Mono',monospace" }}>{total.toFixed(2)} €</span>
                  </div>
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {g.lignes.map(l => (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: FONT.xs.size + 1, color: textSub }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: text }}>{l.libelle}</span>
                          <span style={{ color: textMuted }}> · {l.quantite ?? "?"} {l.unite || ""}</span>
                        </span>
                        <span style={{ flexShrink: 0, fontFamily: "'DM Mono',monospace" }}>{l.prix_total != null ? `${parseFloat(l.prix_total).toFixed(2)} €` : "—"}</span>
                      </div>
                    ))}
                  </div>
                  {/* badges statut */}
                  <div style={{ padding: "0 12px 9px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {badgeCompletude(c.statut_completude)}
                    {badgeFacturation(c.statut_facturation)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitre({ icon, titre, compteur, couleur, textMuted }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <Icon as={icon} size={13} color={couleur}/>
      <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: couleur, textTransform: "uppercase", letterSpacing: .8 }}>{titre}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: textMuted, background: couleur + "1e", borderRadius: RADIUS.pill, padding: "1px 8px" }}>{compteur}</span>
    </div>
  );
}

function pill(label, color, bg) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: .4, padding: "2px 8px", borderRadius: RADIUS.pill, color, background: bg, textTransform: "uppercase" }}>{label}</span>
  );
}
function badgeCompletude(s) {
  if (s === "complete") return pill("Complète", "#22c55e", "rgba(34,197,94,0.14)");
  return pill("À compléter", "#f59e0b", "rgba(245,158,11,0.14)");
}
function badgeFacturation(s) {
  if (s === "facture") return pill("Facturée", "#22c55e", "rgba(34,197,94,0.14)");
  return pill("En attente facture", "#9aa5c0", "rgba(255,255,255,0.06)");
}

// ─── MODALE "COMMANDES DE LA SEMAINE" (onglets par semaine) ──────────────────
function ModaleVendredi({ lignes, onClose, onCommander, T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";

  // 5 semaines glissantes
  const semaines = useMemo(() => {
    const lundi0 = lundiSemaine(new Date());
    return Array.from({ length: 5 }, (_, i) => {
      const debut = addDays(lundi0, i * 7);
      const fin   = addDays(debut, 6);
      return {
        index: i, debut, fin,
        key: "S" + i,
        label: i === 0 ? "Cette semaine" : i === 1 ? "Semaine prochaine" : `S+${i}`,
        num: numeroSemaine(debut),
      };
    });
  }, []);

  // Range chaque ligne dans un seau de semaine. En retard → cette semaine.
  const seaux = useMemo(() => {
    const out = {};
    semaines.forEach(s => { out[s.key] = []; });
    out["plus"] = [];     // au-delà de S+4
    out["sansdate"] = []; // pas de date de besoin
    lignes.forEach(l => {
      if (!l.dateObj) { out["sansdate"].push(l); return; }
      const d = new Date(l.dateObj); d.setHours(0, 0, 0, 0);
      if (d < semaines[0].debut) { out[semaines[0].key].push(l); return; } // en retard → cette semaine
      let placed = false;
      for (const s of semaines) {
        if (d >= s.debut && d <= s.fin) { out[s.key].push(l); placed = true; break; }
      }
      if (!placed) out["plus"].push(l);
    });
    return out;
  }, [lignes, semaines]);

  // Onglets visibles = ceux qui ont des lignes
  const onglets = useMemo(() => {
    const arr = [];
    semaines.forEach(s => { if (seaux[s.key].length) arr.push({ key: s.key, label: s.label, num: s.num, deb: s.debut, fin: s.fin }); });
    if (seaux["plus"].length) arr.push({ key: "plus", label: "Plus tard", num: null });
    if (seaux["sansdate"].length) arr.push({ key: "sansdate", label: "Sans date", num: null });
    return arr;
  }, [seaux, semaines]);

  const [tab, setTab] = useState(() => onglets[0]?.key || "sansdate");
  // Si l'onglet courant disparaît, recaler
  useEffect(() => {
    if (!onglets.find(o => o.key === tab) && onglets[0]) setTab(onglets[0].key);
  }, [onglets, tab]);

  const lignesTab = seaux[tab] || [];

  // Regroupe par fournisseur → puis par chantier (axe demandé : par fournisseur, rassemblé par chantier)
  const groupes = useMemo(() => {
    const map = new Map();
    lignesTab.forEach(l => {
      const fkey = l.fournisseur_id ? "id::" + l.fournisseur_id : (l.fournisseur_nom?.trim() ? "nom::" + l.fournisseur_nom.toLowerCase().trim() : "__sans__");
      const fnom = l.fournisseur_nom?.trim() || "Sans fournisseur";
      if (!map.has(fkey)) map.set(fkey, { fkey, fnom, parChantier: new Map(), total: 0, nb: 0 });
      const g = map.get(fkey);
      if (!g.parChantier.has(l.chantierId)) g.parChantier.set(l.chantierId, { chantierNom: l.chantierNom, chantierCouleur: l.chantierCouleur, lignes: [] });
      g.parChantier.get(l.chantierId).lignes.push(l);
      g.total += (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0);
      g.nb += 1;
    });
    return Array.from(map.values()).sort((a, b) => a.fnom.localeCompare(b.fnom));
  }, [lignesTab]);

  const totalTab = lignesTab.reduce((s, l) => s + (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0), 0);

  // Date de besoin par défaut pour la commande : le vendredi de la semaine de l'onglet (ou la 1re date dispo)
  const dateBesoinTab = useMemo(() => {
    const og = onglets.find(o => o.key === tab);
    if (og?.fin) return addDays(og.deb, 4).toISOString().slice(0, 10); // vendredi
    const withDate = lignesTab.find(l => l.dateISO);
    return withDate?.dateISO || "";
  }, [onglets, tab, lignesTab]);

  const lancerCommande = () => {
    const og = onglets.find(o => o.key === tab);
    const titre = `Commandes ${og?.label || ""}`.trim();
    onCommander(lignesTab, titre, dateBesoinTab);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T?.modal || surface, borderRadius: RADIUS.xl,
        width: "100%", maxWidth: 820, maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${border}`, boxShadow: "0 28px 70px rgba(0,0,0,0.65)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 38, height: 38, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={CalendarClock} size={18}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, letterSpacing: -0.2 }}>Commandes de la semaine</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 2 }}>
              Tout ce qu'il faut commander, par fournisseur et par chantier.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: textMuted, cursor: "pointer", padding: 6, display: "flex" }}>
            <Icon as={X} size={18}/>
          </button>
        </div>

        {/* Onglets semaines */}
        <div style={{ display: "flex", gap: 6, padding: "10px 22px 0", borderBottom: `1px solid ${border}`, overflowX: "auto" }}>
          {onglets.length === 0 ? (
            <div style={{ padding: "8px 0 14px", color: textMuted, fontSize: FONT.sm.size }}>Rien à commander.</div>
          ) : onglets.map(o => {
            const actif = o.key === tab;
            const nb = seaux[o.key].length;
            return (
              <button key={o.key} onClick={() => setTab(o.key)} style={{
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                background: "transparent", border: "none", borderBottom: `2px solid ${actif ? acc.accent : "transparent"}`,
                padding: "8px 10px 12px", color: actif ? text : textMuted, cursor: "pointer",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: actif ? 800 : 600,
              }}>
                {o.label}{o.num ? <span style={{ fontSize: 10, color: textMuted, fontWeight: 600 }}>S{o.num}</span> : null}
                <span style={{ fontSize: 10, fontWeight: 700, color: actif ? acc.accent : textMuted, background: actif ? acc.bg10 : "rgba(255,255,255,0.05)", borderRadius: RADIUS.pill, padding: "0 6px" }}>{nb}</span>
              </button>
            );
          })}
        </div>

        {/* Corps : groupes fournisseur → chantier */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {groupes.length === 0 ? (
            <div style={{ textAlign: "center", color: textMuted, padding: 40, fontSize: FONT.sm.size + 1 }}>Aucun article pour cette semaine.</div>
          ) : groupes.map(g => (
            <div key={g.fkey} style={{ marginBottom: 16, background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 8, background: surface }}>
                <Icon as={Mail} size={14} color={acc.accent}/>
                <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: text }}>{g.fnom}</span>
                <span style={{ fontSize: FONT.xs.size, color: textMuted }}>· {g.nb} article{g.nb > 1 ? "s" : ""}</span>
                <span style={{ marginLeft: "auto", fontSize: FONT.sm.size, fontWeight: 800, color: acc.accent, fontFamily: "'DM Mono',monospace" }}>{g.total.toFixed(2)} € HT</span>
              </div>
              {Array.from(g.parChantier.values()).map((ch, ci) => (
                <div key={ci} style={{ padding: "8px 14px", borderTop: ci > 0 ? `1px solid ${border}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, fontWeight: 700, color: textSub, marginBottom: 4 }}>
                    <Icon as={Building2} size={11} color={ch.chantierCouleur}/> {ch.chantierNom}
                  </div>
                  {ch.lignes.map((l, li) => (
                    <div key={li} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: FONT.xs.size + 1, color: textSub, paddingLeft: 17, lineHeight: 1.6 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ color: text }}>{l.libelle}</span>
                        <span style={{ color: textMuted }}> · {l.quantite} {l.unite} · {l.ouvrageLibelle}</span>
                      </span>
                      <span style={{ flexShrink: 0, fontFamily: "'DM Mono',monospace" }}>{((parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0)).toFixed(2)} €</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 22px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT.sm.size, color: textMuted }}>
            Total {onglets.find(o => o.key === tab)?.label || ""} : <strong style={{ color: text }}>{totalTab.toFixed(2)} € HT</strong> · {lignesTab.length} article{lignesTab.length > 1 ? "s" : ""}
          </span>
          <button onClick={lancerCommande} disabled={lignesTab.length === 0} style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            background: lignesTab.length === 0 ? border : acc.accent, color: lignesTab.length === 0 ? textMuted : "#1a1a1a",
            border: "none", borderRadius: RADIUS.md, padding: "10px 18px",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: lignesTab.length === 0 ? "not-allowed" : "pointer",
          }}>
            <Icon as={ArrowRight} size={14}/> Préparer ces commandes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODALE "PASSER COMMANDE" (générique, multi-chantiers) ───────────────────
// lignesInit : [{ libelle, quantite, unite, prix_ht, fournisseur_id, fournisseur_nom,
//                 materiau_id, chantierId, chantierNom, chantierCouleur, phasageId,
//                 lotId, lotLabel, ouvrageId, ouvrageLibelle }]
function ModaleCommande({ titre, lignesInit, dateBesoinInit, fournisseurs, materiaux = [], onClose, onSuccess, T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const accent    = acc?.accent  || "#FFC200";

  const [etape, setEtape] = useState("recap");
  const [lignes, setLignes] = useState(() => lignesInit.map((m, i) => ({
    uid:             "l_" + i + "_" + Math.random().toString(36).slice(2),
    source:          "prevu",
    checked:         true,
    libelle:         m.libelle || "",
    quantite:        m.quantite ?? 1,
    unite:           m.unite || "U",
    prix_ht:         m.prix_ht || 0,
    fournisseur_id:  m.fournisseur_id || null,
    fournisseur_nom: m.fournisseur_nom || "",
    materiau_id:     m.materiau_id || null,
    chantierId:      m.chantierId || null,
    chantierNom:     m.chantierNom || "",
    phasageId:       m.phasageId || null,
    lotId:           m.lotId || null,
    lotLabel:        m.lotLabel || "",
    ouvrageId:       m.ouvrageId || null,
    ouvrageLibelle:  m.ouvrageLibelle || "",
  })));
  const [dateBesoin, setDateBesoin] = useState(dateBesoinInit || "");
  const [sending, setSending] = useState(false);
  const [statutGroupes, setStatutGroupes] = useState({});
  // Envoi du mail par groupe fournisseur : true par défaut si un email existe.
  // Décoché = commande passée hors appli (téléphone, comptoir…) : on enregistre sans envoyer.
  const [envoiMail, setEnvoiMail] = useState({});
  const doitEnvoyer = (g) => !!g.email && envoiMail[g.key] !== false;

  const setLigne = (uid, patch) => setLignes(prev => prev.map(l => l.uid === uid ? { ...l, ...patch } : l));
  const removeLigne = (uid) => setLignes(prev => prev.filter(l => l.uid !== uid));
  const ajouterLigneManuelle = () => {
    // Hérite du contexte de la 1re ligne (chantier/ouvrage) pour la ventilation.
    const ref = lignes[0] || {};
    setLignes(prev => [...prev, {
      uid: "manuel_" + Math.random().toString(36).slice(2), source: "manuel", checked: true,
      libelle: "", quantite: 1, unite: "U", prix_ht: 0, fournisseur_id: null, fournisseur_nom: "", materiau_id: null,
      chantierId: ref.chantierId || null, chantierNom: ref.chantierNom || "", phasageId: ref.phasageId || null,
      lotId: ref.lotId || null, lotLabel: ref.lotLabel || "", ouvrageId: ref.ouvrageId || null, ouvrageLibelle: ref.ouvrageLibelle || "",
    }]);
  };

  const lignesCochees = lignes.filter(l => l.checked && (l.libelle?.trim() || "") && (parseFloat(l.quantite) || 0) > 0);
  const totalGlobal = lignesCochees.reduce((s, l) => s + (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0), 0);

  // Bibliothèque matériaux indexée par id : photo produit + lien fournisseur.
  const matById = useMemo(() => {
    const m = {};
    materiaux.forEach(x => { m[String(x.id)] = x; });
    return m;
  }, [materiaux]);

  // Regroupement par fournisseur (pour les mails)
  const groupes = useMemo(() => {
    const buckets = new Map();
    lignesCochees.forEach(l => {
      let key, nom, email, mail_type, id = null;
      if (l.fournisseur_id) {
        const f = fournisseurs.find(x => x.id === l.fournisseur_id);
        key = "id::" + l.fournisseur_id; id = l.fournisseur_id;
        nom = f?.nom || l.fournisseur_nom || "(fournisseur supprimé)";
        email = f?.email || null; mail_type = f?.mail_type || null;
      } else if (l.fournisseur_nom?.trim()) {
        const f = fournisseurs.find(x => (x.nom || "").toLowerCase().trim() === l.fournisseur_nom.toLowerCase().trim());
        if (f) { key = "id::" + f.id; id = f.id; nom = f.nom; email = f.email || null; mail_type = f.mail_type || null; }
        else { key = "nom::" + l.fournisseur_nom.toLowerCase().trim(); nom = l.fournisseur_nom.trim(); email = null; mail_type = null; }
      } else { key = "__sans__"; nom = "Sans fournisseur"; email = null; mail_type = null; }
      if (!buckets.has(key)) buckets.set(key, { key, fournisseur_id: id, nom, email, mail_type, lignes: [] });
      buckets.get(key).lignes.push(l);
    });
    return Array.from(buckets.values()).map(g => ({
      ...g,
      total: g.lignes.reduce((s, l) => s + (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0), 0),
      // chantiers distincts dans le groupe (pour grouper l'email par chantier)
      chantiers: Array.from(new Set(g.lignes.map(l => l.chantierNom).filter(Boolean))),
    }));
  }, [lignesCochees, fournisseurs]);

  // ── Helpers texte mail
  const fmtMontant = (n) => (parseFloat(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDateBesoin = (iso) => {
    if (!iso) return "à définir";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  // Liste d'articles, groupée par chantier si le groupe en couvre plusieurs.
  const listeArticlesTexte = (lignesGr) => {
    const parCh = new Map();
    lignesGr.forEach(l => {
      const k = l.chantierNom || "Chantier";
      if (!parCh.has(k)) parCh.set(k, []);
      parCh.get(k).push(l);
    });
    const ligneTxt = (l) => {
      const qte = parseFloat(l.quantite) || 0, pu = parseFloat(l.prix_ht) || 0;
      return `- ${qte}${l.unite ? ` ${l.unite}` : ""} × ${l.libelle} — ${fmtMontant(pu * qte)} € HT`;
    };
    if (parCh.size <= 1) {
      return lignesGr.map(ligneTxt).join("\n");
    }
    return Array.from(parCh.entries()).map(([ch, ls]) =>
      `Chantier ${ch} :\n${ls.map(ligneTxt).join("\n")}`
    ).join("\n\n");
  };

  const TEMPLATE_DEFAUT =
    "Bonjour,\n\nNous souhaitons passer la commande suivante pour le {date_besoin} :\n\n{liste_articles}\n\nTotal HT estimé : {total_ht} €\n\nCordialement,\nProfero Rénovation";

  const construireCorps = (groupe) => {
    const tpl = (groupe.mail_type && groupe.mail_type.trim()) ? groupe.mail_type : TEMPLATE_DEFAUT;
    const chantierLabel = groupe.chantiers.length === 1 ? groupe.chantiers[0] : `${groupe.chantiers.length} chantiers`;
    const phases = Array.from(new Set(groupe.lignes.map(l => l.lotLabel).filter(Boolean)));
    return tpl
      .replaceAll("{chantier}",       chantierLabel)
      .replaceAll("{phase}",          phases.join(", "))
      .replaceAll("{liste_articles}", listeArticlesTexte(groupe.lignes))
      .replaceAll("{date_besoin}",    fmtDateBesoin(dateBesoin))
      .replaceAll("{total_ht}",       fmtMontant(groupe.total));
  };

  const sujetMail = (groupe) => {
    const c = groupe.chantiers.length === 1 ? groupe.chantiers[0] : "Profero (multi-chantiers)";
    return `Commande matériaux — ${c}`;
  };

  const corpsVersHtml = (corpsTexte, groupe) => {
    const escape = (s) => String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    const body = escape(corpsTexte).replace(/\n/g, "<br>");
    const chLabel = groupe.chantiers.length === 1 ? groupe.chantiers[0] : `${groupe.chantiers.length} chantiers`;
    return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1f2e">
  <div style="background:#080a0d;padding:20px 24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
    <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Rénovation · Commande matériaux</div>
    <div style="color:#fff;font-size:18px;font-weight:800">${escape(chLabel)}</div>
  </div>
  <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px;font-size:14px;line-height:1.7">
    ${body}
  </div>
  <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Envoyé via Profero Planning</div>
</div>`;
  };

  const copier = async (texte) => {
    try { await navigator.clipboard.writeText(texte); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = texte; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
  };

  // ── Confirmation : envoi des mails UNIQUEMENT. Aucun bon de commande n'est
  // créé ici (la page est un outil de préparation/suivi) : la commande réelle
  // sera saisie à réception via la page Saisie commande, seule source du coût
  // matériaux. Le parent (onSuccess) marque juste les articles "commandés".
  const confirmer = async () => {
    setSending(true);

    const next = {};
    groupes.forEach(g => { next[g.key] = "pending"; });
    setStatutGroupes(next);

    const resultatsEnvoi = await Promise.all(groupes.map(async (g) => {
      if ((!g.fournisseur_id && g.key === "__sans__") || !g.email) return { key: g.key, status: "none" };
      if (!doitEnvoyer(g)) return { key: g.key, status: "skipped" };
      const corps = construireCorps(g);
      const html  = corpsVersHtml(corps, g);
      try {
        const res = await fetch("/api/send-email", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: g.email, subject: sujetMail(g), html }),
        });
        const data = await res.json().catch(() => ({}));
        return { key: g.key, status: res.ok ? "sent" : "failed", error: data?.error || (!res.ok ? `HTTP ${res.status}` : null) };
      } catch (e) { return { key: g.key, status: "failed", error: e.message }; }
    }));
    const statutFinal = {};
    resultatsEnvoi.forEach(r => { statutFinal[r.key] = r.status; });
    setStatutGroupes(statutFinal);

    setSending(false);
    onSuccess?.(lignesCochees);
  };

  const inp = {
    background: "rgba(255,255,255,0.06)", border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: 8, padding: "6px 9px", color: text,
    fontFamily: "inherit", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", zIndex: 960, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T?.modal || surface, borderRadius: RADIUS.xl,
        width: "100%", maxWidth: 880, maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${border}`, boxShadow: "0 28px 70px rgba(0,0,0,0.65)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 38, height: 38, borderRadius: RADIUS.md, background: accent + "22", color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={ShoppingCart} size={18}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, letterSpacing: -0.2 }}>Passer commande</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titre}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[{ id: "recap", label: "1. Récap" }, { id: "preview", label: "2. Aperçu mails" }].map(s => (
              <div key={s.id} style={{
                fontSize: 11, fontWeight: 700, letterSpacing: .4, textTransform: "uppercase",
                padding: "4px 9px", borderRadius: RADIUS.pill,
                background: etape === s.id ? accent + "22" : "transparent",
                color: etape === s.id ? accent : textMuted,
                border: `1px solid ${etape === s.id ? accent + "55" : border}`, whiteSpace: "nowrap",
              }}>{s.label}</div>
            ))}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: textMuted, cursor: "pointer", padding: 6, display: "flex" }}>
            <Icon as={X} size={18}/>
          </button>
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {etape === "recap" ? (
            <>
              {/* Date de besoin */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: card, borderRadius: RADIUS.md, border: `1px solid ${border}`, flexWrap: "wrap" }}>
                <Icon as={Calendar} size={13} color={textMuted}/>
                <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 600 }}>Date de besoin</span>
                <input type="date" value={dateBesoin || ""} onChange={e => setDateBesoin(e.target.value)} style={{ ...inp, width: 160, colorScheme: "dark" }}/>
              </div>

              {/* Cartes articles : photo + lien produit + champs regroupés */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lignes.map(l => {
                  const total = (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0);
                  const isManuel = l.source === "manuel";
                  const mat = l.materiau_id != null ? matById[String(l.materiau_id)] : null;
                  const photo = mat?.photo_url || null;
                  // Lien fournisseur réel si connu, sinon recherche web sur le libellé.
                  const lienDirect = mat?.lien_fournisseur?.trim() || null;
                  const lien = lienDirect || ((l.libelle || "").trim()
                    ? "https://www.google.com/search?q=" + encodeURIComponent(l.libelle.trim() + (l.fournisseur_nom ? " " + l.fournisseur_nom : ""))
                    : null);
                  return (
                    <div key={l.uid} style={{
                      background: card, border: `1px solid ${border}`, borderRadius: RADIUS.md,
                      padding: "10px 12px", opacity: l.checked ? 1 : .45,
                    }}>
                      {/* Rangée 1 : coche · photo · libellé + contexte + lien · total · suppr */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <input type="checkbox" checked={l.checked} onChange={e => setLigne(l.uid, { checked: e.target.checked })} style={{ accentColor: accent, cursor: "pointer", marginTop: 14 }}/>
                        {photo ? (
                          <a href={lien || photo} target="_blank" rel="noreferrer" style={{ flexShrink: 0, display: "block" }} title={lienDirect ? "Voir chez le fournisseur" : "Rechercher le produit"}>
                            <img src={photo} alt="" style={{ width: 48, height: 48, borderRadius: RADIUS.sm, objectFit: "cover", border: `1px solid ${border}`, background: "#fff", display: "block" }}/>
                          </a>
                        ) : (
                          <div style={{ width: 48, height: 48, borderRadius: RADIUS.sm, background: surface, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Icon as={Package} size={18} color={textMuted}/>
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <input value={l.libelle} onChange={e => setLigne(l.uid, { libelle: e.target.value })} placeholder="Libellé de l'article" style={{ ...inp, fontWeight: 700, fontSize: 14 }}/>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 11, color: textMuted }}>
                            {isManuel && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: .5, padding: "1px 6px", borderRadius: RADIUS.pill, background: "rgba(91,156,246,0.15)", color: "#5b9cf6", textTransform: "uppercase" }}>Manuel</span>}
                            {l.chantierNom && <span style={{ color: textSub, fontWeight: 600 }}>{l.chantierNom}</span>}
                            {l.ouvrageLibelle && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>· {l.ouvrageLibelle}</span>}
                            {lien && (
                              <a href={lien} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#5b9cf6", fontWeight: 700, textDecoration: "none" }}>
                                <Icon as={ExternalLink} size={10}/> {lienDirect ? "Voir chez le fournisseur" : "Rechercher le produit"}
                              </a>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: text, fontFamily: "'DM Mono',monospace", flexShrink: 0, marginTop: 8 }}>{total.toFixed(2)} €</div>
                        <button onClick={() => removeLigne(l.uid)} title="Supprimer la ligne" style={{ background: "transparent", border: "none", color: "#e15a5a", cursor: "pointer", padding: 4, display: "inline-flex", marginTop: 8 }}>
                          <Icon as={Trash2} size={13}/>
                        </button>
                      </div>
                      {/* Rangée 2 : quantité · unité · PU · fournisseur */}
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 8, paddingLeft: 26 }}>
                        {[
                          { label: "Qté", w: 74, el: <input type="number" min="0" step="0.01" value={l.quantite} onChange={e => setLigne(l.uid, { quantite: e.target.value })} style={{ ...inp, textAlign: "center", fontWeight: 700 }}/> },
                          { label: "Unité", w: 60, el: <input value={l.unite || ""} onChange={e => setLigne(l.uid, { unite: e.target.value })} placeholder="U" style={{ ...inp, textAlign: "center" }}/> },
                          { label: "PU HT", w: 92, el: <input type="number" min="0" step="0.01" value={l.prix_ht} onChange={e => setLigne(l.uid, { prix_ht: e.target.value })} style={{ ...inp, textAlign: "right", color: "#22c55e", fontWeight: 700 }}/> },
                        ].map(f => (
                          <div key={f.label} style={{ width: f.w, flexShrink: 0 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 3 }}>{f.label}</div>
                            {f.el}
                          </div>
                        ))}
                        <div style={{ flex: 1, minWidth: 170 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 3 }}>Fournisseur</div>
                          {fournisseurs.length > 0 ? (
                            <select value={l.fournisseur_id || ""} onChange={e => {
                              const id = e.target.value || null;
                              const f = id ? fournisseurs.find(x => x.id === id) : null;
                              setLigne(l.uid, { fournisseur_id: id, fournisseur_nom: f ? f.nom : l.fournisseur_nom });
                            }} style={inp}>
                              <option value="">— {l.fournisseur_nom ? `Texte : « ${l.fournisseur_nom} »` : "Aucun"} —</option>
                              {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                            </select>
                          ) : (
                            <input value={l.fournisseur_nom || ""} onChange={e => setLigne(l.uid, { fournisseur_nom: e.target.value })} placeholder="Nom du fournisseur" style={inp}/>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
                <button onClick={ajouterLigneManuelle} style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: RADIUS.md,
                  background: "transparent", border: `1.5px dashed ${border}`, color: textSub,
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
                }}>
                  <Icon as={Plus} size={12}/> Ajouter un article manuel
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8 }}>Total HT</span>
                  <span style={{ fontSize: FONT.xl.size, fontWeight: 800, color: accent, fontFamily: "'DM Mono',monospace", letterSpacing: -0.3 }}>{totalGlobal.toFixed(2)} €</span>
                  <span style={{ fontSize: 11, color: textMuted }}>· {lignesCochees.length} ligne{lignesCochees.length > 1 ? "s" : ""}</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 12px", background: "rgba(91,156,246,0.10)", border: "1px solid rgba(91,156,246,0.3)", borderRadius: RADIUS.md, color: "#5b9cf6", fontSize: FONT.xs.size + 1, lineHeight: 1.5 }}>
                <Icon as={Info} size={12} style={{ marginTop: 2, flexShrink: 0 }}/>
                <span>
                  {groupes.filter(doitEnvoyer).length} mail{groupes.filter(doitEnvoyer).length > 1 ? "s" : ""} à envoyer
                  {groupes.filter(g => g.email && !doitEnvoyer(g)).length > 0 && ` · ${groupes.filter(g => g.email && !doitEnvoyer(g)).length} sans envoi (passée hors appli)`}
                  {groupes.filter(g => !g.email).length > 0 && ` · ${groupes.filter(g => !g.email).length} groupe(s) sans email (à passer manuellement)`}
                  {" — décochez « Envoyer le mail » pour une commande passée par téléphone ou au comptoir. "}
                  Aucun bon de commande n'est créé ici : la commande réelle sera saisie à réception (page Saisie commande).
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {groupes.map(g => {
                  const corps = construireCorps(g);
                  const statut = statutGroupes[g.key];
                  const isSans = g.key === "__sans__";
                  const noEmail = !g.email;
                  return (
                    <div key={g.key} style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ width: 30, height: 30, borderRadius: RADIUS.md, background: isSans ? "rgba(255,255,255,0.06)" : accent + "22", color: isSans ? textMuted : accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Icon as={isSans ? AlertTriangle : Mail} size={14}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text }}>{g.nom}</div>
                          <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 1 }}>
                            {g.email ? g.email : (isSans ? "Pas d'envoi · à passer en physique" : "Aucun email connu pour ce fournisseur")}
                            <span style={{ marginLeft: 6 }}>· {g.lignes.length} ligne{g.lignes.length > 1 ? "s" : ""} · {g.chantiers.length} chantier{g.chantiers.length > 1 ? "s" : ""} · {fmtMontant(g.total)} € HT</span>
                          </div>
                        </div>
                        {g.email && !statut && (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: doitEnvoyer(g) ? textSub : textMuted, padding: "4px 10px", borderRadius: RADIUS.pill, border: `1px solid ${border}`, background: doitEnvoyer(g) ? "transparent" : "rgba(255,255,255,0.05)", cursor: "pointer", userSelect: "none" }}>
                            <input type="checkbox" checked={doitEnvoyer(g)} onChange={e => setEnvoiMail(prev => ({ ...prev, [g.key]: e.target.checked }))} style={{ accentColor: accent, cursor: "pointer" }}/>
                            Envoyer le mail
                          </label>
                        )}
                        {statut === "pending" && <span style={{ fontSize: 11, fontWeight: 700, color: accent, padding: "3px 9px", borderRadius: RADIUS.pill, background: accent + "22" }}>Envoi…</span>}
                        {statut === "sent" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#22c55e", padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(34,197,94,0.15)" }}><Icon as={Check} size={10}/> Envoyé</span>}
                        {statut === "failed" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#e15a5a", padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(225,90,90,0.15)" }}><Icon as={AlertTriangle} size={10}/> Échec</span>}
                        {statut === "none" && <span style={{ fontSize: 11, fontWeight: 700, color: textMuted, padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(255,255,255,0.05)" }}>Non envoyé</span>}
                        {statut === "skipped" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: textMuted, padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(255,255,255,0.05)" }}><Icon as={Check} size={10}/> Sans envoi</span>}
                      </div>
                      {!isSans && (
                        <div style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Sujet</div>
                            {(statut === "failed" || noEmail || !doitEnvoyer(g)) && (
                              <button onClick={() => copier(`Sujet : ${sujetMail(g)}\n\n${corps}`)} style={{
                                display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: RADIUS.sm, border: `1px solid ${border}`,
                                background: "transparent", color: textSub, fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", fontWeight: 600,
                              }}>
                                <Icon as={Copy} size={11}/> Copier le mail
                              </button>
                            )}
                          </div>
                          <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.md, padding: "8px 12px", fontSize: 13, color: text, marginBottom: 8, fontWeight: 600 }}>{sujetMail(g)}</div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Corps</div>
                          <pre style={{
                            background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.md, padding: "10px 14px",
                            fontFamily: "inherit", fontSize: 13, color: textSub, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
                            margin: 0, maxHeight: 240, overflowY: "auto",
                          }}>{corps}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 22px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <button onClick={etape === "preview" ? () => setEtape("recap") : onClose} disabled={sending} style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${border}`,
            borderRadius: RADIUS.md, padding: "9px 16px", color: textSub, fontFamily: "inherit", fontSize: FONT.sm.size,
            cursor: sending ? "not-allowed" : "pointer", opacity: sending ? .5 : 1,
          }}>
            <Icon as={etape === "preview" ? ChevronLeft : X} size={13}/>
            {etape === "preview" ? "Retour au récap" : "Annuler"}
          </button>
          {etape === "recap" ? (
            <button onClick={() => setEtape("preview")} disabled={lignesCochees.length === 0} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: lignesCochees.length === 0 ? border : accent, color: lignesCochees.length === 0 ? textMuted : "#1a1a1a",
              border: "none", borderRadius: RADIUS.md, padding: "9px 18px", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
              cursor: lignesCochees.length === 0 ? "not-allowed" : "pointer",
            }}>
              Aperçu des mails <Icon as={ArrowRight} size={13}/>
            </button>
          ) : (
            <button onClick={confirmer} disabled={sending} style={{
              display: "inline-flex", alignItems: "center", gap: 6, background: sending ? border : accent, color: sending ? textMuted : "#1a1a1a",
              border: "none", borderRadius: RADIUS.md, padding: "9px 20px", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
              cursor: sending ? "not-allowed" : "pointer",
            }}>
              {(() => {
                const nbMails = groupes.filter(doitEnvoyer).length;
                return (
                  <>
                    <Icon as={nbMails > 0 ? Send : Check} size={13}/>
                    {sending
                      ? (nbMails > 0 ? "Envoi en cours…" : "Marquage…")
                      : (nbMails > 0 ? "Confirmer et envoyer" : "Marquer comme commandé")}
                  </>
                );
              })()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── VUE "DEMANDES OUVRIERS" (paniers) ───────────────────────────────────────
function VueDemandes({ paniers, loading, onValider, onRefuser, onRetirerArticle, T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const border    = T?.border    || "rgba(255,255,255,0.07)";

  if (loading) {
    return <div style={{ textAlign: "center", color: textMuted, padding: 80, fontSize: FONT.base.size }}>Chargement…</div>;
  }
  if (paniers.length === 0) {
    return (
      <div style={{ background: surface, border: `1px dashed ${border}`, borderRadius: RADIUS.xl, padding: "60px 30px", textAlign: "center", color: textMuted }}>
        <div style={{ width: 64, height: 64, borderRadius: RADIUS.xl, background: acc.bg10, color: acc.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <Icon as={Inbox} size={28} strokeWidth={1.5}/>
        </div>
        <div style={{ fontSize: FONT.lg.size, color: text, fontWeight: 700, marginBottom: 6 }}>Aucune demande en attente</div>
        <div style={{ fontSize: FONT.sm.size + 1, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
          Les paniers envoyés par les ouvriers depuis leur espace apparaîtront ici, prêts à valider.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
      {paniers.map(p => (
        <PanierCard key={p.panierId} panier={p} onValider={onValider} onRefuser={onRefuser} onRetirerArticle={onRetirerArticle} T={T} acc={acc}/>
      ))}
    </div>
  );
}

function PanierCard({ panier, onValider, onRefuser, onRetirerArticle, T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const urgent    = panier.priorite === "urgent";
  const dateFmt   = panier.dateObj
    ? panier.dateObj.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div style={{ background: surface, border: `1px solid ${urgent ? "#e15a5a55" : border}`, borderRadius: RADIUS.lg, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* En-tête panier */}
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${border}`, background: card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: panier.chantierCouleur, flexShrink: 0 }}/>
          <span style={{ fontSize: FONT.sm.size + 2, fontWeight: 800, color: text, letterSpacing: -0.2 }}>{panier.chantierNom}</span>
          {urgent && (
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: .5, color: "#e15a5a", background: "rgba(225,90,90,0.14)", borderRadius: RADIUS.pill, padding: "2px 8px", textTransform: "uppercase" }}>
              <Icon as={AlertTriangle} size={10}/> Urgent
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: FONT.xs.size, color: textMuted, flexWrap: "wrap" }}>
          {panier.ouvrier && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={User} size={11}/> {panier.ouvrier}</span>}
          {dateFmt && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Calendar} size={11}/> {dateFmt}</span>}
          <span>· {panier.articles.length} article{panier.articles.length > 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Articles */}
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        {panier.articles.map(a => {
          const clickable = !!a.lien;
          const infoLine = (
            <>
              <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 600, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                {a.article || "(article)"}
                {clickable && <Icon as={ExternalLink} size={12} color={a.lienDirect ? acc.accent : textMuted} style={{ flexShrink: 0 }}/>}
              </div>
              {(a.quantite || a.notes) && (
                <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.quantite ? `Qté : ${a.quantite}` : ""}{a.quantite && a.notes ? " · " : ""}{a.notes || ""}
                  {clickable && !a.lienDirect && <span style={{ color: textMuted }}> · rechercher</span>}
                </div>
              )}
            </>
          );
          const vignette = a.image ? (
            <img src={a.image} alt="" style={{ width: 44, height: 44, borderRadius: RADIUS.sm, objectFit: "cover", flexShrink: 0, background: surface }}/>
          ) : (
            <div style={{ width: 44, height: 44, borderRadius: RADIUS.sm, flexShrink: 0, background: surface, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", color: textMuted }}>
              <Icon as={Package} size={18}/>
            </div>
          );
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: card, border: `1px solid ${border}`, borderRadius: RADIUS.md }}>
              {clickable ? (
                <a href={a.lien} target="_blank" rel="noreferrer" title={a.lienDirect ? "Ouvrir la fiche fournisseur" : "Rechercher cet article sur le web"}
                  style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textDecoration: "none", cursor: "pointer" }}>
                  {vignette}
                  <div style={{ flex: 1, minWidth: 0 }}>{infoLine}</div>
                </a>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                  {vignette}
                  <div style={{ flex: 1, minWidth: 0 }}>{infoLine}</div>
                </div>
              )}
              <button onClick={() => onRetirerArticle(a)} title="Retirer cet article" style={{ background: "transparent", border: "none", color: textMuted, cursor: "pointer", padding: 4, display: "inline-flex", flexShrink: 0 }}>
                <Icon as={X} size={13}/>
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", gap: 8 }}>
        <button onClick={() => onRefuser(panier)} style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${border}`,
          borderRadius: RADIUS.md, padding: "8px 14px", color: textSub, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
        }}>
          <Icon as={X} size={13}/> Refuser
        </button>
        <button onClick={() => onValider(panier)} style={{
          flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
          background: acc.accent, color: "#1a1a1a", border: "none", borderRadius: RADIUS.md, padding: "8px 14px",
          fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
        }}>
          <Icon as={Check} size={14}/> Valider le panier
        </button>
      </div>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function EmptyState({ T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  return (
    <div style={{ background: surface, border: `1px dashed ${border}`, borderRadius: RADIUS.xl, padding: "60px 30px", textAlign: "center", color: textMuted }}>
      <div style={{ width: 64, height: 64, borderRadius: RADIUS.xl, background: acc.bg10, color: acc.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Icon as={Package} size={28} strokeWidth={1.5}/>
      </div>
      <div style={{ fontSize: FONT.lg.size, color: text, fontWeight: 700, marginBottom: 6 }}>Aucun chantier avec des matériaux</div>
      <div style={{ fontSize: FONT.sm.size + 1, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
        Ouvre la page <strong style={{ color: text }}>Phasage</strong>, sélectionne un chantier, puis ajoute des ouvrages avec leurs matériaux. Ils apparaîtront ici, prêts à commander.
      </div>
    </div>
  );
}
