import React, { useState, useEffect } from "react";
import { useIsMobile } from "../hooks";
import {
  LayoutDashboard, HardHat, Calendar, CalendarDays, ClipboardList, Package,
  Users, Ruler, ListChecks, BookOpen, BookMarked, Layers, IdCard, FileText, Settings,
  ChevronLeft, ChevronRight, Sun, Moon, LogOut, LayoutGrid, Menu, X, ShoppingCart,
  Calculator, CheckCircle2, Camera, Receipt, Wallet,
  Pencil, Check, RotateCcw, GripVertical, Clock, ChartBar, Newspaper, Wrench, Building2, Lightbulb, Bell, NotebookPen,
  MessageSquare, ClipboardCheck, Smartphone, CalendarCheck, CalendarX, ShieldCheck,
} from "lucide-react";
import { LOGO_RENO_H, LOGO_RENO_V, getBranchAccent, RADIUS, FONT } from "../constants";
import { Icon } from "../ui";
import BoutonAide from "./PageAide";
import { supabase } from "../supabase";
import { estPageDuMenu } from "./navigationOperations.js";
import { lireNavOrder, ordreHabituel, etatDuJour, ecrireOrdre, reinitialiserOrdre, ordreBarreDuBas,
  boutonOrdreHabituel, activerOrdreHabituel, desactiverOrdreHabituel, basculerOrdreHabituel } from "./organisationJour.js";
import { dateDuJour } from "./dateDuJour.js";

// ─── ORDRE DES ONGLETS (nav_order) ────────────────────────────────────────────
// Source de vérité : la colonne utilisateurs.nav_order (Supabase), qui suit
// l'utilisateur d'un appareil à l'autre. localStorage sert de cache instantané /
// hors-ligne et stocke exactement la même valeur que la base : une simple liste
// d'identifiants (ancien format, utilisateurs sans organisation) ou l'objet
// { ordre, jours, … } (organisation de la semaine). Les deux formats sont lus
// par organisationJour.mjs. Barre latérale et barre du bas partagent la valeur
// (événement EVT_NAV_ORDER) pour rester alignées après un glisser-déposer.
const EVT_NAV_ORDER = "profero:nav-order";
const cleNavOrder = (profil) => `nav_order_${profil?.id || profil?.email || "anon"}`;
const estNavOrderLisible = (v) => v !== null && typeof v === "object"; // liste ou objet

// Dernière valeur appliquée pendant cette session, par utilisateur. Le `profil`
// d'App.jsx est lu une fois à la connexion : après un enregistrement (glisser-
// déposer, écran « Mon organisation »…), un composant monté plus tard (panneau
// du profil rouvert, passage ordinateur ↔ téléphone) doit relire la valeur
// enregistrée, pas celle de la connexion.
const valeursDeLaSession = new Map();

function lireNavOrderInitial(profil) {
  const cle = cleNavOrder(profil);
  if (valeursDeLaSession.has(cle)) return valeursDeLaSession.get(cle);
  if (estNavOrderLisible(profil?.nav_order)) return profil.nav_order;
  try {
    const raw = localStorage.getItem(cleNavOrder(profil));
    const v = raw ? JSON.parse(raw) : null;
    return estNavOrderLisible(v) ? v : null;
  } catch { return null; }
}

function useNavOrder(profil) {
  const cle = cleNavOrder(profil);
  const [navOrder, setNavOrderLocal] = useState(() => lireNavOrderInitial(profil));
  // Profil arrivé (ou changé) après le premier rendu : relire sa valeur.
  const cleLue = React.useRef(cle);
  useEffect(() => {
    if (cleLue.current === cle) return;
    cleLue.current = cle;
    setNavOrderLocal(lireNavOrderInitial(profil));
  }, [cle]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const surChangement = (e) => { if (e.detail?.cle === cle) setNavOrderLocal(e.detail.valeur); };
    window.addEventListener(EVT_NAV_ORDER, surChangement);
    return () => window.removeEventListener(EVT_NAV_ORDER, surChangement);
  }, [cle]);
  // Applique la nouvelle valeur localement (état + cache) et prévient l'autre
  // barre. L'inventaire des écritures vers `utilisateurs` est figé par
  // scripts/verif-utilisateurs-champs-sensibles.mjs : les deux seules
  // écritures sont ici — sauvegarderNavOrder (glisser-déposer, réinitialisation
  // avec organisation, bouton « Ordre habituel aujourd'hui », écran « Mon
  // organisation ») et la remise à null d'enregistrerNavOrder
  // (« Réinitialiser l'ordre » sans organisation, « Supprimer mon organisation »).
  const appliquerLocal = (valeur) => {
    setNavOrderLocal(valeur);
    valeursDeLaSession.set(cle, valeur);
    try {
      if (valeur === null) localStorage.removeItem(cle);
      else localStorage.setItem(cle, JSON.stringify(valeur));
    } catch {}
    try { window.dispatchEvent(new CustomEvent(EVT_NAV_ORDER, { detail: { cle, valeur } })); } catch {}
  };
  // Enregistre `ids` (liste simple ou objet { ordre, jours, … }) : cache + base.
  // Renvoie une promesse { error } (l'écran « Mon organisation » l'affiche).
  const sauvegarderNavOrder = (ids) => {
    appliquerLocal(ids);
    if (!profil?.id) return Promise.resolve({ error: null });
    return supabase.from("utilisateurs").update({ nav_order: ids }).eq("id", profil.id)
      .then(({ error }) => { if (error) console.warn("nav_order (sauvegarde) :", error.message); return { error }; });
  };
  // Enregistre n'importe quelle valeur, null compris (null = colonne vidée,
  // comportement d'avant toute personnalisation). En cas d'échec en base, la
  // valeur précédente est rétablie localement et l'erreur est rendue.
  const enregistrerNavOrder = (valeur) => {
    const precedente = navOrder;
    let envoi;
    if (valeur !== null) envoi = sauvegarderNavOrder(valeur);
    else {
      appliquerLocal(null);
      envoi = !profil?.id ? Promise.resolve({ error: null })
        : supabase.from("utilisateurs").update({ nav_order: null }).eq("id", profil.id)
          .then(({ error }) => { if (error) console.warn("nav_order (réinit.) :", error.message); return { error }; });
    }
    return Promise.resolve(envoi)
      .catch((e) => ({ error: e }))
      .then((r) => { if (r?.error) appliquerLocal(precedente); return r || { error: null }; });
  };
  return [navOrder, appliquerLocal, sauvegarderNavOrder, enregistrerNavOrder];
}

// ─── ORGANISATION DU JOUR (hook partagé) ──────────────────────────────────────
// Barre latérale, barre du bas, page d'arrivée (App.jsx) et, plus tard, le
// bandeau du tableau de bord lisent la même valeur. Les actions du bouton
// « Ordre habituel aujourd'hui » (règle 7) passent par la même écriture que le
// glisser-déposer ; les deux barres se mettent à jour aussitôt (EVT_NAV_ORDER).
function useOrganisationDuJour(profil) {
  const [navOrder, , sauvegarderNavOrder] = useNavOrder(profil);
  const date = dateDuJour();
  const etat = etatDuJour([], navOrder, date);
  const bouton = boutonOrdreHabituel(navOrder, date); // null = bouton masqué
  const enregistrer = (valeur) => { if (valeur !== navOrder) sauvegarderNavOrder(valeur); };
  return {
    navOrder,
    date,
    organisation: etat.organisation,   // null : week-end, jour non configuré, sans organisation
    ordreHabituelActif: etat.ordreHabituel,
    bouton,
    activerOrdreHabituel: () => enregistrer(activerOrdreHabituel(navOrder, date)),
    desactiverOrdreHabituel: () => enregistrer(desactiverOrdreHabituel(navOrder)),
    basculerOrdreHabituel: () => enregistrer(basculerOrdreHabituel(navOrder, date)),
  };
}

// ─── HOOK MOBILE ──────────────────────────────────────────────────────────────
const ROLE_LABELS = { admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable", charge_affaires:"Chargé d'affaires" };

// ─── PAGES PAR RÔLE ───────────────────────────────────────────────────────────
const ROLE_PAGES = {
  admin: [
    "dashboard","chantiers","planning","bilan-semaine","alertes","retours-terrain","planning-mensuel","notes-todo","notes-ouvriers","commandes","capture-cmd","rapprochement","encours-fournisseurs","planning-commandes",
    "equipe","qualite-cr","inventaire-equipes","validation","heures-salaries","plans","phasage-v2","operations","justificatifs-entreprise","bibliotheque","biblio-materiaux","suggestions-mat",
    "info-client","etats-financiers","guide-ouvrages","journal-maj","admin"
  ],
  conducteur: [
    "dashboard","chantiers","planning","bilan-semaine","alertes","retours-terrain","planning-mensuel","notes-todo","notes-ouvriers","commandes","capture-cmd","rapprochement","encours-fournisseurs","planning-commandes",
    "equipe","qualite-cr","inventaire-equipes","validation","heures-salaries","plans","phasage-v2","operations","justificatifs-entreprise","bibliotheque","biblio-materiaux","suggestions-mat",
    "info-client","journal-maj"
  ],
  commercial: [
    "dashboard","chantiers","operations","planning","notes-ouvriers","plans","info-client","journal-maj"
  ],
  comptable: [
    "dashboard","chantiers","bilan-semaine","notes-ouvriers","commandes","biblio-materiaux","phasage-v2","operations","heures-salaries","etats-financiers","journal-maj"
  ],
  // Lot 6 : sans cette entrée, un chargé d'affaires retomberait sur le menu admin.
  charge_affaires: [
    "operations","chantiers","info-client","journal-maj"
  ],
};

// ─── NAVIGATION BAS (MOBILE) ──────────────────────────────────────────────────
// Liste complète des pages avec icône + label court (pour bottom-nav) + label long (pour la feuille modale).
const ALL_NAV_ITEMS = [
  { id:"dashboard",        icon:LayoutDashboard, label:"Accueil",    longLabel:"Tableau de bord"     },
  // Lot 5 : Opérations est la porte d'entrée (2e position) ; « chantiers »
  // (la fiche) reste dans la liste pour son libellé, filtré hors du menu.
  { id:"operations",       icon:Building2,       label:"Opérations", longLabel:"Opérations" },
  { id:"justificatifs-entreprise", icon:ShieldCheck, label:"Justif.",  longLabel:"Justificatifs entreprise" },
  { id:"chantiers",        icon:HardHat,         label:"Chantiers",  longLabel:"Fiche chantier"      },
  { id:"planning",         icon:Calendar,        label:"Planning",   longLabel:"Planning semaine"    },
  { id:"bilan-semaine",    icon:ChartBar,        label:"Bilan",      longLabel:"Bilan de semaine"    },
  { id:"alertes",          icon:Bell,            label:"Alertes",    longLabel:"Alertes"             },
  { id:"retours-terrain",  icon:MessageSquare,   label:"Retours",    longLabel:"Retours du terrain"  },
  { id:"notes-todo",       icon:ClipboardList,   label:"Notes",      longLabel:"Notes & To-do"       },
  { id:"notes-ouvriers",   icon:NotebookPen,     label:"Terrain",    longLabel:"Notes des ouvriers"  },
  { id:"planning-mensuel", icon:CalendarDays,    label:"Mensuel",    longLabel:"Planning mensuel"    },
  { id:"commandes",        icon:Package,         label:"Cmd.",       longLabel:"Commandes"           },
  { id:"capture-cmd",      icon:Camera,          label:"Saisie",     longLabel:"Saisie commande (mobile)" },
  { id:"rapprochement",    icon:Receipt,         label:"Factures",   longLabel:"Rapprochement factures" },
  { id:"encours-fournisseurs", icon:Wallet,      label:"Encours",    longLabel:"Encours fournisseurs" },
  { id:"planning-commandes", icon:ShoppingCart,  label:"À passer",   longLabel:"Commandes à passer" },
  { id:"equipe",           icon:Users,           label:"Équipe",     longLabel:"Équipe"              },
  { id:"qualite-cr",       icon:ClipboardCheck,  label:"Qualité CR", longLabel:"Qualité des comptes rendus" },
  { id:"inventaire-equipes", icon:Wrench,        label:"Matériel",   longLabel:"Inventaire des équipes" },
  { id:"validation",       icon:CheckCircle2,    label:"Valid.",     longLabel:"Validation de fin de journée" },
  { id:"heures-salaries",  icon:Clock,           label:"Heures",     longLabel:"Heures des salariés" },
  { id:"plans",            icon:Ruler,           label:"Plans",      longLabel:"Plans"               },
  { id:"phasage-v2",       icon:ListChecks,      label:"Phasage",    longLabel:"Phasage" },
  { id:"bibliotheque",     icon:BookOpen,        label:"Biblio.",    longLabel:"Biblio. ouvrages"    },
  { id:"biblio-materiaux", icon:Layers,          label:"Matériaux",  longLabel:"Biblio. matériaux"   },
  { id:"info-client",      icon:IdCard,          label:"Chiffrage",  longLabel:"Chiffrage"           },
  { id:"etats-financiers", icon:Calculator,      label:"États fin.", longLabel:"États financiers"    },
  { id:"suggestions-mat",  icon:Lightbulb,       label:"Suggestions",longLabel:"Suggestions de matériaux" },
  { id:"guide-ouvrages",   icon:BookMarked,      label:"Guide",      longLabel:"Guide ouvrages"      },
  { id:"journal-maj",      icon:Newspaper,       label:"MAJ",        longLabel:"Journal des MAJ"     },
  { id:"admin",            icon:Settings,        label:"Réglages",   longLabel:"Réglages"            },
];

function BottomNav({ page, setPage, T, role = "admin", branch = "renovation", rolePages = null, profil = null }) {
  const acc = getBranchAccent(branch);
  const [sheetOpen, setSheetOpen] = useState(false);
  const orgJour = useOrganisationDuJour(profil);
  const navOrder = orgJour.navOrder;

  // Si rolePages (config dynamique) est fourni : on l'utilise.
  // Sinon : fallback sur la matrice par défaut hardcodée ROLE_PAGES.
  const allowed = (rolePages && rolePages[role]) || ROLE_PAGES[role] || ROLE_PAGES.admin;
  // Lot 5 : la liste Chantiers n'est plus dans le menu (fiche ouverte via Opérations).
  const allowedItems = ALL_NAV_ITEMS.filter(n => allowed.includes(n.id) && estPageDuMenu(n.id));
  // Organisation de la semaine : quand l'organisation du jour est active, même
  // ordre que la barre latérale (raccourcis du jour) ; sinon, ordre par défaut
  // de la barre du bas, inchangé (elle n'a jamais suivi le glisser-déposer).
  const idsMenu = idsPagesDuMenu(role, rolePages);
  const itemParId = new Map(allowedItems.map(n => [n.id, n]));
  const itemsDuJour = ordreBarreDuBas(allowedItems.map(n => n.id), idsMenu, navOrder, dateDuJour())
    .map(id => itemParId.get(id)).filter(Boolean);

  // Si ≤ 5 pages au total : on les affiche toutes, pas de bouton Plus.
  // Sinon : 4 raccourcis prioritaires + bouton Plus qui ouvre la feuille avec le reste.
  const useSheet = itemsDuJour.length > 5;
  const mainItems = useSheet ? itemsDuJour.slice(0, 4) : itemsDuJour;
  const sheetItems = useSheet ? itemsDuJour.slice(4) : [];

  // Si la page courante est dans la feuille, on met le bouton Plus en "actif" pour le signaler visuellement.
  const sheetActive = useSheet && sheetItems.some(n => n.id === page);

  const handleSelect = (id) => {
    setPage(id);
    setSheetOpen(false);
  };

  return (
    <>
      <div className="bottom-nav-mobile">
        {mainItems.map(n => {
          const active = page === n.id;
          return (
            <button key={n.id} onClick={() => handleSelect(n.id)} style={{
              flex:1, display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", padding:"8px 2px 6px", border:"none",
              background: active ? acc.bg10 : "transparent",
              cursor:"pointer", fontFamily:"inherit", transition:"all .12s",
              borderTop: active ? `2px solid ${acc.accent}` : "2px solid transparent",
              marginTop: -2,
            }}>
              <Icon as={n.icon} size={20} strokeWidth={active ? 2 : 1.75}
                color={active ? acc.accent : "rgba(255,255,255,0.45)"} />
              <span style={{
                fontSize:9, fontWeight: active ? 700 : 500, marginTop:4,
                color: active ? acc.accent : "rgba(255,255,255,0.45)",
                letterSpacing:.3, textTransform:"uppercase",
              }}>{n.label}</span>
            </button>
          );
        })}
        {useSheet && (
          <button onClick={() => setSheetOpen(true)} style={{
            flex:1, display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", padding:"8px 2px 6px", border:"none",
            background: sheetActive ? acc.bg10 : "transparent",
            cursor:"pointer", fontFamily:"inherit", transition:"all .12s",
            borderTop: sheetActive ? `2px solid ${acc.accent}` : "2px solid transparent",
            marginTop: -2,
          }}>
            <Icon as={Menu} size={20} strokeWidth={sheetActive ? 2 : 1.75}
              color={sheetActive ? acc.accent : "rgba(255,255,255,0.45)"} />
            <span style={{
              fontSize:9, fontWeight: sheetActive ? 700 : 500, marginTop:4,
              color: sheetActive ? acc.accent : "rgba(255,255,255,0.45)",
              letterSpacing:.3, textTransform:"uppercase",
            }}>Plus</span>
          </button>
        )}
      </div>

      {sheetOpen && (
        <MoreSheet
          items={sheetItems}
          currentPage={page}
          onSelect={handleSelect}
          onClose={() => setSheetOpen(false)}
          T={T}
          acc={acc}
          boutonOrdreHabituel={orgJour.bouton}
          onBasculerOrdreHabituel={orgJour.basculerOrdreHabituel}
        />
      )}
    </>
  );
}

// ─── FEUILLE MODALE « PLUS » (MOBILE) ─────────────────────────────────────────
function MoreSheet({ items, currentPage, onSelect, onClose, T, acc, boutonOrdreHabituel = null, onBasculerOrdreHabituel = null }) {
  // Empêche le scroll du body pendant l'ouverture de la feuille
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:300,
        background:"rgba(0,0,0,0.55)",
        display:"flex", alignItems:"flex-end",
        animation:"moreSheetFadeIn .15s ease-out",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width:"100%", maxHeight:"85vh", overflowY:"auto",
          background: T.surface, color: T.text,
          borderRadius:"20px 20px 0 0",
          borderTop:`2px solid ${acc.accent}`,
          paddingBottom:"calc(env(safe-area-inset-bottom) + 12px)",
          animation:"moreSheetSlideUp .22s ease-out",
        }}
      >
        {/* Poignée */}
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 4px" }}>
          <div style={{ width:40, height:4, borderRadius:2, background:T.border }}/>
        </div>

        {/* En-tête */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"6px 18px 12px", borderBottom:`1px solid ${T.border}`,
        }}>
          <span style={{ fontSize:13, fontWeight:700, letterSpacing:.5, textTransform:"uppercase", color:T.textSub }}>
            Toutes les pages
          </span>
          <button onClick={onClose} aria-label="Fermer" style={{
            background:"transparent", border:"none", cursor:"pointer",
            color:T.textSub, padding:6, display:"flex", alignItems:"center", justifyContent:"center",
            borderRadius:RADIUS.md,
          }}>
            <Icon as={X} size={20}/>
          </button>
        </div>

        {/* Organisation du jour : « Ordre habituel aujourd'hui » (règle 7) */}
        {boutonOrdreHabituel && onBasculerOrdreHabituel && (
          <div style={{ padding:"8px 18px 0", display:"flex", justifyContent:"flex-end" }}>
            <button onClick={onBasculerOrdreHabituel} style={{
              display:"inline-flex", alignItems:"center", gap:6,
              background:"transparent", border:`1px solid ${T.border}`, borderRadius:RADIUS.md,
              padding:"7px 12px", cursor:"pointer", fontFamily:"inherit",
              fontSize:13, fontWeight:600, color:T.textSub,
            }}>
              <Icon as={boutonOrdreHabituel.actif ? CalendarCheck : CalendarX} size={15}/>
              {boutonOrdreHabituel.libelle}
            </button>
          </div>
        )}

        {/* Liste des pages */}
        <div style={{ padding:"8px 10px 4px" }}>
          {items.map(n => {
            const active = currentPage === n.id;
            return (
              <button key={n.id} onClick={() => onSelect(n.id)} style={{
                width:"100%", display:"flex", alignItems:"center", gap:14,
                padding:"14px 14px", border:"none", borderRadius:RADIUS.md,
                background: active ? acc.bg10 : "transparent",
                color: active ? acc.accent : T.text,
                cursor:"pointer", fontFamily:"inherit", fontSize:15,
                fontWeight: active ? 700 : 500, textAlign:"left",
                marginBottom:2,
              }}>
                <Icon as={n.icon} size={20} strokeWidth={active ? 2 : 1.75}
                  color={active ? acc.accent : T.textSub}/>
                <span style={{ flex:1 }}>{n.longLabel}</span>
                {active && <span style={{ width:4, height:18, borderRadius:2, background:acc.accent }}/>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
// Pages de la branche Rénovation (réutilisé par la barre d'onglets).
const allNav = [
  { id:"dashboard",        icon:LayoutDashboard, label:"Tableau de bord"  },
  // Lot 5 : Opérations est la porte d'entrée (2e position) ; « chantiers »
  // reste ici pour le libellé de l'onglet de la fiche, filtré hors du menu.
  { id:"operations",       icon:Building2,       label:"Opérations"       },
  { id:"justificatifs-entreprise", icon:ShieldCheck, label:"Justificatifs entreprise" },
  { id:"chantiers",        icon:HardHat,         label:"Fiche chantier"   },
  { id:"planning",         icon:Calendar,        label:"Planning semaine" },
  { id:"bilan-semaine",    icon:ChartBar,        label:"Bilan de semaine" },
  { id:"alertes",          icon:Bell,            label:"Alertes"          },
  { id:"retours-terrain",  icon:MessageSquare,   label:"Retours du terrain" },
  { id:"planning-mensuel", icon:CalendarDays,    label:"Planning mensuel" },
  { id:"notes-todo",       icon:ClipboardList,   label:"Notes & To-do"    },
  { id:"notes-ouvriers",   icon:NotebookPen,     label:"Notes des ouvriers" },
  { id:"commandes",        icon:Package,         label:"Commandes"        },
  { id:"capture-cmd",      icon:Camera,          label:"Saisie commande"  },
  { id:"rapprochement",    icon:Receipt,         label:"Rapprochement factures" },
  { id:"encours-fournisseurs", icon:Wallet,      label:"Encours fournisseurs" },
  { id:"planning-commandes", icon:ShoppingCart,  label:"Commandes à passer" },
  { id:"equipe",           icon:Users,           label:"Équipe"           },
  { id:"qualite-cr",       icon:ClipboardCheck,  label:"Qualité des comptes rendus" },
  { id:"inventaire-equipes", icon:Wrench,        label:"Inventaire des équipes" },
  { id:"validation",       icon:CheckCircle2,    label:"Validation fin de journée" },
  { id:"heures-salaries",  icon:Clock,           label:"Heures des salariés" },
  { id:"plans",            icon:Ruler,           label:"Plans"            },
  { id:"phasage-v2",       icon:ListChecks,      label:"Phasage" },
  { id:"bibliotheque",     icon:BookOpen,        label:"Biblio. ouvrages" },
  { id:"biblio-materiaux", icon:Layers,          label:"Biblio. matériaux"},
  { id:"info-client",      icon:IdCard,          label:"Chiffrage"        },
  { id:"etats-financiers", icon:Calculator,      label:"États financiers"   },
  { id:"suggestions-mat",  icon:Lightbulb,       label:"Suggestions de matériaux" },
  { id:"guide-ouvrages",   icon:BookMarked,      label:"Guide ouvrages"   },
  { id:"journal-maj",      icon:Newspaper,       label:"Journal des MAJ"  },
  { id:"admin",            icon:Settings,        label:"Réglages"         },
];
const LABELS_PAGES = Object.fromEntries(allNav.map(n => [n.id, n.label]));

// Pages du menu autorisées pour le rôle, dans l'ordre par défaut : exactement
// la liste `allowedNav` de la barre latérale (rolePages chargé depuis la base,
// ajout automatique admin compris ; repli sur ROLE_PAGES). Sert à la barre du
// bas et à la page d'arrivée (App.jsx).
function idsPagesDuMenu(role, rolePages) {
  const allowed = (rolePages && rolePages[role]) || ROLE_PAGES[role] || ROLE_PAGES.admin;
  return allNav.filter(n => allowed.includes(n.id) && estPageDuMenu(n.id)).map(n => n.id);
}

function Sidebar({
  page, setPage, T, role = "admin", branch = "renovation",
  rolePages = null, onOuvrirDansNouvelOnglet = null,
  // Tout l'ancien contenu de la topbar :
  profil, theme, setTheme, onLogout, peutChangerBranche, onRetourPortail,
  onOuvrirProfil = null,
  // Cloche des notifications (bouton déjà construit par App.jsx ; null pour un ouvrier).
  cloche = null,
  syncing = false, connected = true, lastSync = null,
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar_collapsed") === "1");
  const acc = getBranchAccent(branch);


  const allowed = (rolePages && rolePages[role]) || ROLE_PAGES[role] || ROLE_PAGES.admin;
  // Lot 5 : la liste Chantiers n'est plus dans le menu (fiche ouverte via Opérations).
  const allowedNav = allNav.filter(n => allowed.includes(n.id) && estPageDuMenu(n.id));

  // ── Réorganisation des onglets (mémorisée par utilisateur, voir useNavOrder) ──
  const [editOrder, setEditOrder] = useState(false);
  const [navOrder, , sauvegarderNavOrder, enregistrerNavOrder] = useNavOrder(profil);
  const orgJour = useOrganisationDuJour(profil); // bouton « Ordre habituel aujourd'hui »
  const ordrePerso = lireNavOrder(navOrder).ordre; // ordre habituel choisi (null = par défaut)
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  // Hors édition : ordre du jour (pages « en tête » de l'organisation du jour,
  // puis l'ordre habituel ; sans organisation = l'ordre habituel, comme avant).
  // En édition : toujours l'ordre HABITUEL, celui que règle le glisser-déposer,
  // pour ne jamais enregistrer l'ordre d'un jour comme ordre habituel.
  const byId = new Map(allowedNav.map(n => [n.id, n]));
  const idsAutorises = allowedNav.map(n => n.id);
  const idsAffiches = editOrder
    ? ordreHabituel(idsAutorises, ordrePerso)
    : etatDuJour(idsAutorises, navOrder, dateDuJour()).pages;
  const nav = idsAffiches.map(id => byId.get(id)).filter(Boolean);

  // Règle `ordre` sans effacer `jours` ; sans organisation, liste simple comme avant.
  const persistOrder = (ordre) => sauvegarderNavOrder(ecrireOrdre(navOrder, ordre));

  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = nav.map(n => n.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) { setDragId(null); setOverId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    persistOrder(ids);
    setDragId(null); setOverId(null);
  };

  // Sans organisation : null, comme avant ; avec : l'objet sans `ordre` (jours
  // gardés), enregistré par le même appel que la sauvegarde.
  const resetOrder = () => {
    const ids = reinitialiserOrdre(navOrder);
    if (ids !== null) { sauvegarderNavOrder(ids); return; }
    enregistrerNavOrder(null);
  };

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) { setEditOrder(false); setDragId(null); setOverId(null); }
    localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
  };

  const switchTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
  };

  const W = collapsed ? 64 : 220;
  const sidebarBtnStyle = (color, bgHover) => ({
    display:"flex", alignItems:"center", justifyContent:"center",
    width: 32, height: 32, borderRadius: RADIUS.md,
    background: "transparent", border:"none", cursor:"pointer",
    color: color, transition:"background .15s",
    flexShrink: 0,
  });

  return (
    <div style={{
      width:W, flexShrink:0, background:T.sidebar, borderRight:`1px solid ${T.sidebarBorder}`,
      display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh", zIndex:50,
      transition:"width .2s ease", overflow:"hidden",
    }}>

      {/* Logo + toggle */}
      <div style={{
        padding: collapsed ? "14px 0" : "16px 14px 12px",
        display:"flex", alignItems:"center",
        justifyContent: collapsed ? "center" : "space-between",
        gap:8, flexShrink:0, borderBottom:`1px solid ${T.sidebarBorder}`,
      }}>
        {!collapsed && (
          <img src={LOGO_RENO_H} alt="Profero Rénovation" style={{ height:44, objectFit:"contain", objectPosition:"left" }}/>
        )}
        {collapsed && (
          <div style={{ width:44, height:44, borderRadius:RADIUS.md, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <img src={LOGO_RENO_V} alt="P" style={{ width:44, height:44, objectFit:"contain" }}/>
          </div>
        )}
        <button onClick={toggle} title={collapsed ? "Agrandir le menu" : "Réduire le menu"} style={{
          background:"rgba(255,255,255,0.06)", border:"none", borderRadius:RADIUS.md,
          width:28, height:28, cursor:"pointer", color:"rgba(255,255,255,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center",
          flexShrink:0, transition:"background .15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = acc.bg20}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}>
          <Icon as={collapsed ? ChevronRight : ChevronLeft} size={14} />
        </button>
      </div>

      {/* Nav items */}
      <nav style={{ flex:1, padding: collapsed ? "8px 6px" : "8px", overflowY:"auto" }}>
        {nav.map(n => {
          const active = page === n.id;
          const separateur = n.id === "info-client" && !editOrder;
          const isOver = editOrder && overId === n.id && dragId !== n.id;
          return (
            <React.Fragment key={n.id}>
              {separateur && (
                <div style={{
                  height:1, background:acc.bg20,
                  margin: collapsed ? "8px 4px" : "8px 10px",
                }}/>
              )}
              <button
                onClick={(e) => {
                  if (editOrder) return;
                  if ((e.metaKey || e.ctrlKey) && onOuvrirDansNouvelOnglet) onOuvrirDansNouvelOnglet(n.id);
                  else setPage(n.id);
                }}
                onAuxClick={(e) => { if (e.button === 1 && !editOrder && onOuvrirDansNouvelOnglet) { e.preventDefault(); onOuvrirDansNouvelOnglet(n.id); } }}
                title={collapsed ? n.label : ""}
                draggable={editOrder && !collapsed}
                onDragStart={editOrder ? () => setDragId(n.id) : undefined}
                onDragOver={editOrder ? (e) => { e.preventDefault(); if (overId !== n.id) setOverId(n.id); } : undefined}
                onDrop={editOrder ? (e) => { e.preventDefault(); handleDrop(n.id); } : undefined}
                onDragEnd={editOrder ? () => { setDragId(null); setOverId(null); } : undefined}
                style={{
                  width:"100%", display:"flex", alignItems:"center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap:12, padding: collapsed ? "11px 0" : "10px 12px",
                  borderRadius:RADIUS.md, border:"none",
                  cursor: editOrder ? "grab" : "pointer", fontFamily:"inherit",
                  fontSize:13.5, fontWeight: active ? 700 : 500, letterSpacing:.1,
                  background: active && !editOrder ? acc.bg10 : "transparent",
                  color: active && !editOrder ? acc.accent : "rgba(255,255,255,0.55)",
                  marginBottom:2, transition:"background .12s, color .12s", textAlign:"left",
                  whiteSpace:"nowrap",
                  opacity: dragId === n.id ? 0.4 : 1,
                  boxShadow: isOver ? `inset 0 2px 0 ${acc.accent}` : "none",
                }}
                onMouseEnter={e => { if (!active && !editOrder) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={e => { if (!active && !editOrder) e.currentTarget.style.background = "transparent"; }}>
                <Icon as={n.icon} size={18} strokeWidth={active ? 2 : 1.75}
                  style={{ flexShrink:0 }} />
                {!collapsed && <>
                  <span style={{ flex:1 }}>{n.label}</span>
                  {editOrder
                    ? <Icon as={GripVertical} size={16} color="rgba(255,255,255,0.35)" style={{ flexShrink:0 }}/>
                    : active && <span style={{ width:3, height:18, borderRadius:2, background:acc.accent, display:"block" }}/>}
                </>}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* ── Organisation du jour : « Ordre habituel aujourd'hui » (règle 7) ── */}
      {orgJour.bouton && !editOrder && (
        <div style={{ padding: collapsed ? "4px 0" : "4px 10px", display:"flex", justifyContent: collapsed ? "center" : "flex-start", flexShrink:0 }}>
          <button onClick={orgJour.basculerOrdreHabituel}
            title={orgJour.bouton.actif ? "Revenir à l'organisation du jour" : "Ordre habituel aujourd'hui : menu et tableau de bord sans l'organisation du jour, jusqu'à demain"}
            style={{
              display:"flex", alignItems:"center", gap:6, maxWidth:"100%",
              background:"transparent", border:"none", cursor:"pointer", fontFamily:"inherit",
              padding: collapsed ? 6 : "4px 6px", borderRadius:RADIUS.md,
              fontSize: FONT.xs.size + 1, color:"rgba(255,255,255,0.45)", whiteSpace:"nowrap",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}>
            <Icon as={orgJour.bouton.actif ? CalendarCheck : CalendarX} size={13} style={{ flexShrink:0 }}/>
            {!collapsed && <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{orgJour.bouton.libelle}</span>}
          </button>
        </div>
      )}

      {/* ── Sync indicator ── */}
      <div style={{
        padding: collapsed ? "8px 0" : "10px 14px",
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex",
        alignItems:"center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: 8,
        flexShrink:0,
      }} title={syncing ? "Synchronisation en cours" : connected ? "En ligne" : "Hors ligne"}>
        <span style={{
          width:8, height:8, borderRadius:"50%",
          background: syncing ? "#f5a623" : connected ? "#22c55e" : "#ef4444",
          flexShrink:0,
          animation: connected && !syncing ? "pulse 2s infinite" : "none",
        }}/>
        {!collapsed && (
          <span style={{ fontSize: FONT.xs.size + 1,
            color: editOrder ? acc.accent : "rgba(255,255,255,0.55)", letterSpacing: .2,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {editOrder
              ? "Glissez pour réorganiser"
              : syncing ? "Synchronisation…" : connected ? `En ligne${lastSync ? ` · ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}` : ""}` : "Hors ligne"}
          </span>
        )}

        {/* Modifier l'ordre des onglets */}
        {!collapsed && (
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:2 }}>
            {editOrder ? (
              <>
                {ordrePerso && (
                  <button onClick={resetOrder} title="Rétablir l'ordre par défaut" style={{
                    background:"transparent", border:"none", cursor:"pointer", padding:5,
                    color:"rgba(255,255,255,0.5)", display:"flex", borderRadius:RADIUS.md,
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <Icon as={RotateCcw} size={14}/>
                  </button>
                )}
                <button onClick={() => { setEditOrder(false); setDragId(null); setOverId(null); }}
                  title="Terminer" style={{
                    background:acc.bg10, border:"none", cursor:"pointer", padding:5,
                    color:acc.accent, display:"flex", borderRadius:RADIUS.md,
                  }}>
                  <Icon as={Check} size={14}/>
                </button>
              </>
            ) : (
              <button onClick={() => setEditOrder(true)} title="Modifier l'ordre des onglets" style={{
                background:"transparent", border:"none", cursor:"pointer", padding:5,
                color:"rgba(255,255,255,0.4)", display:"flex", borderRadius:RADIUS.md,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}>
                <Icon as={Pencil} size={13}/>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── User info ── */}
      {profil && !collapsed && (
        <div
          {...(onOuvrirProfil ? {
            role:"button", tabIndex:0, title:"Mon profil · notifications, mon organisation",
            onClick:onOuvrirProfil,
            onKeyDown:e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOuvrirProfil(); } },
          } : {})}
          style={{
          padding:"10px 14px",
          borderTop:`1px solid ${T.sidebarBorder}`,
          display:"flex", alignItems:"center", gap:8,
          flexShrink:0, cursor: onOuvrirProfil ? "pointer" : "default",
        }}>
          <div style={{ display:"flex", flexDirection:"column", gap:1, minWidth:0, flex:1 }}>
            <span style={{ fontSize: FONT.sm.size, fontWeight:700, color:"#fff", letterSpacing:.1,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>{profil?.nom || profil?.email}</span>
            <span style={{ fontSize: FONT.xs.size, letterSpacing:.8, textTransform:"uppercase",
              color: acc.accent, opacity:.75, fontWeight:600,
            }}>{ROLE_LABELS[role] || role}</span>
          </div>
          {onOuvrirProfil && <Icon as={Smartphone} size={15} color="rgba(255,255,255,0.45)" style={{ flexShrink:0 }}/>}
        </div>
      )}

      {/* ── Action buttons : Portail / Theme / Logout ── */}
      <div style={{
        padding: collapsed ? "8px 6px 10px" : "10px 12px 12px",
        borderTop:`1px solid ${T.sidebarBorder}`,
        display:"flex",
        flexDirection: collapsed ? "column" : "row",
        gap: collapsed ? 4 : 6,
        flexShrink:0,
        alignItems:"center",
        justifyContent: collapsed ? "center" : "space-between",
      }}>
        {peutChangerBranche && (
          <button onClick={onRetourPortail} title="Retour au portail"
            style={sidebarBtnStyle(acc.accent)}
            onMouseEnter={e => e.currentTarget.style.background = acc.bg10}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <Icon as={LayoutGrid} size={16}/>
          </button>
        )}
        {cloche}
        <BoutonAide page={page} T={T} branch={branch}
          style={sidebarBtnStyle("rgba(255,255,255,0.55)")}
          hoverBg="rgba(255,255,255,0.06)"/>
        <button onClick={switchTheme} title={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
          style={sidebarBtnStyle("rgba(255,255,255,0.55)")}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <Icon as={theme === "dark" ? Sun : Moon} size={16}/>
        </button>
        <button onClick={onLogout} title="Se déconnecter"
          style={sidebarBtnStyle("#e15a5a")}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(225,90,90,0.10)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <Icon as={LogOut} size={16}/>
        </button>
      </div>
    </div>
  );
}

export { useIsMobile, BottomNav, Sidebar, LABELS_PAGES, idsPagesDuMenu, useOrganisationDuJour, useNavOrder };
