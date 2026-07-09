import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { OngletAcces } from "../Renovation/Admin";
import {
  LayoutDashboard, Users, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer,
} from "lucide-react";

import {
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection, MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT, STATUTS_PROP, CompletionBar
} from "./_shared";

// ─── SUIVI FINANCIER PROFERO INVEST ──────────────────────────────────────────
const SUIVI_FIN_MONTHS = ["Déc. 25","Jan. 26","Fév. 26","Mar. 26","Avr. 26","Mai 26","Juin 26","Juil. 26","Août 26","Sep. 26","Oct. 26","Nov. 26","Dec. 26","Janv. 27","Fev. 27","Mars 27"];
const SUIVI_FIN_DEFAULT = {
  "version": 1,
  "params": {
    "tauxIS": 15,
    "tvaCollecteePct": 20,
    "tresoDepart": 3200,
    "objectifTreso": 30000,
    "objectifCA": 100000,
    "forfaitFixeHT": 1583.33,
    "commissionPctGain": 50
  },
  "commercial": {
    "pipeline": [
      {
        "id": "r7",
        "label": "Prospects contactés",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r8",
        "label": "1ers RDV réalisés",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r9",
        "label": "Signatures contrats",
        "values": [
          4.0,
          4.0,
          1.0,
          1.0,
          4.0,
          1.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0
        ]
      }
    ],
    "forfaits": [
      {
        "id": "r11",
        "label": "Tom & Camille",
        "values": [
          1250.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r12",
        "label": "Artur F.",
        "values": [
          1250.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r13",
        "label": "Louison",
        "values": [
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r14",
        "label": "Alex & Delphine",
        "values": [
          1250.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r15",
        "label": "Thibault Martin",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r16",
        "label": "Pierre Poilvilain",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r17",
        "label": "Thomas Legault",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r18",
        "label": "Jules Landais",
        "values": [
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r19",
        "label": "Raphael Sanyas",
        "values": [
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r20",
        "label": "Fabien Norniella",
        "values": [
          0,
          0,
          0,
          1583.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r21",
        "label": "Marius Chaillou (SARL CHAIL'HOME)",
        "values": [
          0,
          0,
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r22",
        "label": "William Anitei",
        "values": [
          0,
          0,
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r23",
        "label": "Léo/Léa",
        "values": [
          0,
          0,
          0,
          0,
          1583.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r24",
        "label": "Mathieu Rabineau",
        "values": [
          0,
          0,
          0,
          0,
          0.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r25",
        "label": "Maelys et lukas",
        "values": [
          0,
          0,
          0,
          0,
          0,
          1583.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r26",
        "label": "Prévisions futures (€)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "negociation": [
      {
        "id": "r29",
        "label": "Tom & Camille",
        "values": [
          0,
          0,
          0,
          0,
          10833.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r30",
        "label": "Artur F.",
        "values": [
          0,
          3125.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r31",
        "label": "Louison",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          3932.5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r32",
        "label": "Alex & Delphine",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r33",
        "label": "Thibault Martin",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r34",
        "label": "Pierre Poilvilain",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r35",
        "label": "Thomas Legault",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r36",
        "label": "Jules Landais",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r37",
        "label": "Raphael Sanyas",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          10416.67,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r38",
        "label": "Fabien Norniella",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r39",
        "label": "Marius Chaillou (SARL CHAIL'HOME)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r40",
        "label": "William Anitei",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r41",
        "label": "Léo/Léa",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r42",
        "label": "Mathieu Rabineau",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r43",
        "label": "Maelys et Lukas",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r44",
        "label": "Prévisions futures (€)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "autres": [
      {
        "id": "r47",
        "label": "Autres recettes (à définir)",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r48",
        "label": "Prévisions futures",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ]
  },
  "finance": {
    "chargesFixes": [
      {
        "id": "r6",
        "label": "Alimentaire / repas",
        "values": [
          438.6,
          666.31,
          636.22,
          530.05,
          794.65,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r7",
        "label": "Quote-part Loyer",
        "values": [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r8",
        "label": "Expert-comptable",
        "values": [
          0,
          0,
          382.8,
          382.8,
          382.8,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r9",
        "label": "Rémunération TOM",
        "values": [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          500.0,
          1258.33,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r10",
        "label": "Rémunération MF",
        "values": [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r11",
        "label": "Autres charges fixes",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "chargesVariables": [
      {
        "id": "r14",
        "label": "Prospection FLUIDIFY",
        "values": [
          1692.0,
          1692.0,
          1692.0,
          1692.0,
          1692.0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r15",
        "label": "Licences Fluidify",
        "values": [
          339.5,
          339.5,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r16",
        "label": "Sales Navigator",
        "values": [
          99.99,
          99.99,
          99.99,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r17",
        "label": "LEMLIST (emailing)",
        "values": [
          435.18,
          48.6,
          352.98,
          48.6,
          48.6,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r18",
        "label": "Carburant / déplacements",
        "values": [
          342.86,
          264.33,
          196.17,
          223.79,
          353.11,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r20",
        "label": "Frais bureau / logiciels",
        "values": [
          240.06,
          27.6,
          164.19,
          108.2,
          437.66,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r21",
        "label": "Depenses exceptionnelles",
        "values": [
          276.2,
          37.0,
          0,
          3795.79,
          49.86,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      },
      {
        "id": "r24",
        "label": "Autres dépenses variables",
        "values": [
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ],
    "tvaDeductible": [
      {
        "id": "r47",
        "label": "TVA déductible (sur achats TTC)",
        "values": [
          772.88,
          635.07,
          704.87,
          1356.25,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        ]
      }
    ]
  }
};

const FIN_LEGACY_ROW_IDS_TO_REMOVE = new Set(["r14", "r23", "r32", "r41"]);
const finNormalizeName = (v) => String(v || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const finPruneLegacyRows = (payload = {}) => {
  const next = JSON.parse(JSON.stringify(payload || {}));

  // Ces anciennes lignes étaient présentes dans les données par défaut.
  // Elles ne doivent plus réapparaître après suppression.
  if (Array.isArray(next.commercial?.forfaits)) {
    next.commercial.forfaits = next.commercial.forfaits.filter(
      r => !FIN_LEGACY_ROW_IDS_TO_REMOVE.has(String(r?.id || ""))
    );
  }

  if (Array.isArray(next.commercial?.negociation)) {
    next.commercial.negociation = next.commercial.negociation.filter(
      r => !FIN_LEGACY_ROW_IDS_TO_REMOVE.has(String(r?.id || ""))
    );
  }

  return next;
};

const cloneSuiviFinancier = () => finPruneLegacyRows(SUIVI_FIN_DEFAULT);
const finEvalExpression = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^=/, "").replace(/€/g, "").replace(/\s/g, "").replace(/,/g, ".");
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return parseFloat(cleaned) || 0;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${cleaned});`)();
    return Number.isFinite(result) ? result : 0;
  } catch { return parseFloat(cleaned) || 0; }
};
const finNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return finEvalExpression(v);
};
const finSum = (arr) => (arr || []).reduce((s, v) => s + finNum(v), 0);
const finVec = () => SUIVI_FIN_MONTHS.map(() => 0);
const finEmptyVec = () => SUIVI_FIN_MONTHS.map(() => "");
const finIsZeroLike = (v) => v === 0 || v === "0" || v === "0.0" || v === "0.00";
const FIN_START_YEAR = 2025;
const FIN_START_MONTH = 11; // Décembre 2025, mois JS 0-11
const finMonthIndexFromDate = (value) => {
  if (!value) return -1;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return -1;
  const idx = (d.getFullYear() - FIN_START_YEAR) * 12 + d.getMonth() - FIN_START_MONTH;
  return idx >= 0 && idx < SUIVI_FIN_MONTHS.length ? idx : -1;
};
const finClientName = (c) => `${c?.prenom || ""} ${c?.nom || ""}`.trim() || c?.email || "Client sans nom";
const finMergeSignedClients = (source, clients = []) => {
  const next = JSON.parse(JSON.stringify(source || cloneSuiviFinancier()));
  next.commercial = next.commercial || {};
  next.commercial.pipeline = next.commercial.pipeline || [];
  next.commercial.forfaits = next.commercial.forfaits || [];
  const forfait = finNum(next.params?.forfaitFixeHT ?? 1583.33);
  const signedClients = (clients || []).filter(c => !!c.date_signature);

  next.deletedRowKeys = next.deletedRowKeys || {};
  next.deletedAutoClientIds = Array.isArray(next.deletedAutoClientIds) ? next.deletedAutoClientIds : [];

  const existingByClientId = new Set(next.commercial.forfaits.map(r => r.auto_client_id).filter(Boolean));
  const deletedAutoClientIds = new Set(next.deletedAutoClientIds.filter(Boolean));
  const deletedForfaitLabels = new Set(next.deletedRowKeys["commercial.forfaits"] || []);
  const existingNames = new Set(next.commercial.forfaits.map(r => finNormalizeName(r.label)).filter(Boolean));
  signedClients.forEach(c => {
    const clientLabel = finClientName(c);
    const clientKey = finNormalizeName(clientLabel);
    if (
      existingByClientId.has(c.id) ||
      existingNames.has(clientKey) ||
      deletedAutoClientIds.has(c.id) ||
      deletedForfaitLabels.has(clientKey)
    ) return;
    const mi = finMonthIndexFromDate(c.date_signature);
    if (mi < 0) return;
    const values = finEmptyVec();
    values[mi] = forfait;
    next.commercial.forfaits.push({
      id: `auto_client_${c.id}`,
      auto_client_id: c.id,
      label: clientLabel,
      values,
      payment_status: ""
    });
    existingByClientId.add(c.id);
    existingNames.add(clientKey);
  });
  const counts = finVec();
  signedClients.forEach(c => { const mi = finMonthIndexFromDate(c.date_signature); if (mi >= 0) counts[mi] += 1; });
  let sigRow = next.commercial.pipeline.find(r => String(r.label || "").toLowerCase().includes("signature"));
  if (!sigRow) {
    sigRow = { id:`auto_signatures_${Date.now()}`, label:"Signatures contrats", values:finVec() };
    next.commercial.pipeline.push(sigRow);
  }
  sigRow.values = SUIVI_FIN_MONTHS.map((_, i) => Math.max(finNum(sigRow.values?.[i]), counts[i]));
  return next;
};
const finRowsSum = (rows) => SUIVI_FIN_MONTHS.map((_, i) => (rows || []).reduce((s, r) => s + finNum(r.values?.[i]), 0));
const finIsPaidRow = (row) => String(row?.payment_status || "").toLowerCase() === "regle";
const finRowsSumWhere = (rows, predicate) => SUIVI_FIN_MONTHS.map((_, i) =>
  (rows || []).reduce((s, r) => predicate(r) ? s + finNum(r.values?.[i]) : s, 0)
);
const finRowsPaidSum = (rows) => finRowsSumWhere(rows, finIsPaidRow);
const finRowsUnpaidSum = (rows) => finRowsSumWhere(rows, r => !finIsPaidRow(r));
const finAddVec = (...vectors) => SUIVI_FIN_MONTHS.map((_, i) => vectors.reduce((s, v) => s + finNum(v?.[i]), 0));
const finSubVec = (a, b) => SUIVI_FIN_MONTHS.map((_, i) => finNum(a?.[i]) - finNum(b?.[i]));
const finMulVec = (a, pct) => SUIVI_FIN_MONTHS.map((_, i) => finNum(a?.[i]) * finNum(pct) / 100);
const finPct = (num, den) => finNum(den) ? finNum(num) / finNum(den) : 0;
const finLastNonZero = (arr) => {
  for (let i = (arr || []).length - 1; i >= 0; i--) if (Math.abs(finNum(arr[i])) > 0.0001) return finNum(arr[i]);
  return 0;
};
const finEur = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(finNum(v)) + " €";
const finPctFmt = (v) => Number.isFinite(v) ? (v * 100).toFixed(1).replace(".", ",") + " %" : "—";
const SUIVI_FIN_BILAN1_END_INDEX = 3;
const finBilan1 = (arr) => finSum((arr || []).slice(0, SUIVI_FIN_BILAN1_END_INDEX + 1));
const finTotalAnnuel = (arr) => finSum((arr || []).slice(SUIVI_FIN_BILAN1_END_INDEX + 1));
const finTvaRateForRow = (row) => {
  const label = String(row?.label || "");
  // Tom facture ses commissions/rémunérations sans TVA : aucune TVA déductible à calculer.
  if (/\b(tom|fourmond)\b/i.test(label)) return 0;
  return /alimentaire|repas/i.test(label) ? 10 : 20;
};
const finTvaDeductibleRows = (finance = {}) => [
  ...(finance.chargesFixes || []), ...(finance.chargesVariables || [])
].map(r => ({ id:`tva_${r.id || r.label}`, label:r.label || "Charge", rate:finTvaRateForRow(r), values:SUIVI_FIN_MONTHS.map((_,i)=>finNum(r.values?.[i]) * finTvaRateForRow(r) / 100) }));


function calcSuiviFinancier(data) {
  const d = data || cloneSuiviFinancier();
  const p = d.params || {};

  // CA reconnu dans les indicateurs financiers = uniquement les montants HT marqués "Réglé".
  // Les lignes non réglées, partielles ou non qualifiées restent suivies à part en "CA HT non réglé".
  const forfaitsRegles = finRowsPaidSum(d.commercial?.forfaits);
  const negociationReglee = finRowsPaidSum(d.commercial?.negociation);
  const autresRegles = finRowsPaidSum(d.commercial?.autres);
  const forfaitsNonRegles = finRowsUnpaidSum(d.commercial?.forfaits);
  const negociationNonReglee = finRowsUnpaidSum(d.commercial?.negociation);
  const autresNonRegles = finRowsUnpaidSum(d.commercial?.autres);

  const forfaits = forfaitsRegles;
  const negociation = negociationReglee;
  const autres = autresRegles;
  const ca = finAddVec(forfaitsRegles, negociationReglee, autresRegles);
  const caNonRegle = finAddVec(forfaitsNonRegles, negociationNonReglee, autresNonRegles);
  const caSaisi = finAddVec(ca, caNonRegle);

  const chargesFixes = finRowsSum(d.finance?.chargesFixes);
  const chargesVariables = finRowsSum(d.finance?.chargesVariables);
  const decaissements = finAddVec(chargesFixes, chargesVariables);
  const margeBrute = finSubVec(ca, chargesVariables);
  const tauxMarge = SUIVI_FIN_MONTHS.map((_, i) => finPct(margeBrute[i], ca[i]));
  const rnAvantIS = finSubVec(margeBrute, chargesFixes);
  const impotIS = rnAvantIS.map(v => Math.max(0, finNum(v)) * finNum(p.tauxIS ?? 15) / 100);
  const rnApresIS = finSubVec(rnAvantIS, impotIS);
  const tauxRentabiliteNette = SUIVI_FIN_MONTHS.map((_, i) => finPct(rnApresIS[i], ca[i]));
  const tvaCollectee = finMulVec(ca.map(v => finNum(v) * 1.2), p.tvaCollecteePct ?? 20);
  const tvaDeductibleRows = finTvaDeductibleRows(d.finance || {});
  const tvaDeductible = finRowsSum(tvaDeductibleRows);
  const tvaNette = finSubVec(tvaCollectee, tvaDeductible);
  const treso = [];
  let current = finNum(p.tresoDepart ?? 0);
  ca.forEach((v, i) => { current += finNum(v) - finNum(decaissements[i]); treso.push(current); });
  const signatures = (d.commercial?.pipeline || []).find(r => String(r.label || "").toLowerCase().includes("signature"))?.values || finVec();
  const prospects = (d.commercial?.pipeline || []).find(r => String(r.label || "").toLowerCase().includes("prospect"))?.values || finVec();
  const rdv = (d.commercial?.pipeline || []).find(r => String(r.label || "").toLowerCase().includes("rdv"))?.values || finVec();
  return {
    forfaits, negociation, autres, ca, caNonRegle, caSaisi,
    forfaitsRegles, negociationReglee, autresRegles,
    forfaitsNonRegles, negociationNonReglee, autresNonRegles,
    chargesFixes, chargesVariables, decaissements, margeBrute, tauxMarge,
    rnAvantIS, impotIS, rnApresIS, tauxRentabiliteNette,
    tvaCollectee, tvaDeductibleRows, tvaDeductible, tvaNette,
    treso, signatures, prospects, rdv
  };
}

function FinKPI({ label, value, sub, color, icon: IconComp, T }) {
  const c = color || T.accent;
  return (
    <div className="inv-kpi" style={{ display:"flex", flexDirection:"row", alignItems:"center", gap:SPACING.md, borderLeft:`3px solid ${c}` }}>
      {IconComp && <div style={{ width:38, height:38, borderRadius:RADIUS.md, flexShrink:0, background:`${c}18`, color:c, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={IconComp} size={18} strokeWidth={2}/></div>}
      <div style={{ minWidth:0, flex:1 }}>
        <div className="inv-kpi-lbl">{label}</div>
        <div className="inv-kpi-val" style={{ color:c, fontSize:FONT.xl.size+2 }}>{value}</div>
        {sub && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}

const finIsFormulaValue = (v) => {
  const raw = String(v ?? "").trim();
  if (!raw) return false;
  const cleaned = raw.replace(/^=/, "").replace(/€/g, "").replace(/\s/g, "").replace(/,/g, ".");
  return /[+*/()]/.test(cleaned) || /\d-\d/.test(cleaned);
};

function SuiviFinanceCell({ value, onChange, T, money=true, highlight=false }) {
  const [editing, setEditing] = useState(false);
  const raw = value ?? "";
  const hasFormula = finIsFormulaValue(raw);
  const displayValue = (raw === "" || finIsZeroLike(raw))
    ? ""
    : editing
      ? raw
      : money
        ? finEur(raw)
        : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(finNum(raw));
  return (
    <input
      className="inv-inp"
      type="text"
      inputMode="decimal"
      value={displayValue}
      title={hasFormula ? `Calcul : ${raw} = ${money ? finEur(raw) : finNum(raw)}` : "Cliquez pour saisir un montant ou un calcul, ex : 100+200"}
      onFocus={e => { setEditing(true); setTimeout(() => e.target.select?.(), 0); }}
      onBlur={() => setEditing(false)}
      onChange={e => onChange(e.target.value)}
      style={{ width:"100%", border:"none", borderLeft:`1px solid ${T.rowBorder}`, borderRadius:0, background:hasFormula && !editing ? T.accentBg : (highlight ? "rgba(34,197,94,0.08)" : "transparent"), color:hasFormula && !editing ? T.accent : T.textSub, padding:"7px 5px", fontSize:FONT.xs.size, textAlign:"right" }}
    />
  );
}

function SuiviFinanceTable({ title, rows, sectionPath, data, setData, scheduleSave, T, canAdd=true, money=true, showPaymentStatus=false, validatedMonths=null }) {
  const updateLabel = (idx, value) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b][idx].label = value;
    setData(next); scheduleSave(next);
  };
  const updateValue = (idx, monthIdx, value) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    if (!next[a][b][idx].values) next[a][b][idx].values = finEmptyVec();
    next[a][b][idx].values[monthIdx] = value;
    setData(next); scheduleSave(next);
  };
  const updatePaymentStatus = (idx, value) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b][idx].payment_status = value;
    setData(next); scheduleSave(next);
  };
  const addRow = () => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    next[a][b].push({ id:`custom_${Date.now()}`, label:"Nouvelle ligne", values:finEmptyVec(), ...(showPaymentStatus ? { payment_status:"" } : {}) });
    setData(next); scheduleSave(next);
  };
  const removeRow = (idx) => {
    const next = JSON.parse(JSON.stringify(data));
    const [a,b] = sectionPath.split(".");
    const fullPath = `${a}.${b}`;
    const removedRow = next?.[a]?.[b]?.[idx];

    next.deletedRowKeys = next.deletedRowKeys || {};
    const removedKey = finNormalizeName(removedRow?.label);

    if (removedKey) {
      next.deletedRowKeys[fullPath] = Array.from(new Set([
        ...(next.deletedRowKeys[fullPath] || []),
        removedKey
      ]));
    }

    if (fullPath === "commercial.forfaits" && removedRow?.auto_client_id) {
      next.deletedAutoClientIds = Array.from(new Set([
        ...(next.deletedAutoClientIds || []),
        removedRow.auto_client_id
      ]));
    }

    next[a][b].splice(idx, 1);
    setData(next); scheduleSave(next);
  };
  const totals = finRowsSum(rows);
  const paidTotals = showPaymentStatus ? finRowsPaidSum(rows) : totals;
  const unpaidTotals = showPaymentStatus ? finRowsUnpaidSum(rows) : finVec();
  const gridCols = `minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) ${showPaymentStatus ? "minmax(82px,.75fr)" : ""} 26px`;
  const paymentBg = (r) => {
    if (!showPaymentStatus || finSum(r.values) <= 0) return "transparent";
    if (r.payment_status === "regle") return "rgba(34,197,94,0.10)";
    if (r.payment_status === "non_regle") return "rgba(239,68,68,0.08)";
    if (r.payment_status === "partiel") return "rgba(245,158,11,0.08)";
    return "rgba(245,158,11,0.05)";
  };
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className="inv-card-hd" style={{ justifyContent:"space-between" }}>
        <span>{title}</span>
        {canAdd && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addRow}><Icon as={Plus} size={12}/> Ajouter</button>}
      </div>
      <div className="inv-card-bd" style={{ padding:0, overflowX:"auto" }}>
        <div style={{ width:"100%", minWidth:920 }}>
          <div style={{ display:"grid", gridTemplateColumns:gridCols, gap:0, background:T.sectionHd, borderBottom:`1px solid ${T.border}` }}>
            <div style={{ padding:"8px 8px", fontSize:FONT.xs.size-1, color:T.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:.8 }}>Poste</div>
            {SUIVI_FIN_MONTHS.map(m => <div key={m} style={{ padding:"8px 3px", fontSize:FONT.xs.size-2, color:T.textMuted, fontWeight:800, textAlign:"right" }}>{m}</div>)}
            <div style={{ padding:"8px 4px", fontSize:FONT.xs.size-1, color:T.accent, fontWeight:800, textAlign:"right" }}>Total</div>
            {showPaymentStatus && <div style={{ padding:"8px 4px", fontSize:FONT.xs.size-2, color:T.textMuted, fontWeight:800, textAlign:"center" }}>Paiement</div>}
            <div />
          </div>
          {(rows || []).map((r, ri) => (
            <div key={r.id || ri} style={{ display:"grid", gridTemplateColumns:gridCols, borderBottom:`1px solid ${T.rowBorder}`, alignItems:"center", background:paymentBg(r) }}>
              <input className="inv-inp" value={r.label || ""} onChange={e=>updateLabel(ri,e.target.value)} style={{ width:"100%", textAlign:"left", border:"none", background:"transparent", color:T.text, fontFamily:"inherit", fontWeight:600, fontSize:FONT.xs.size+1, padding:"7px 8px" }}/>
              {SUIVI_FIN_MONTHS.map((m, mi) => (
                <SuiviFinanceCell
                  key={m}
                  value={r.values?.[mi] ?? ""}
                  onChange={value => updateValue(ri, mi, value)}
                  T={T}
                  money={money}
                  highlight={!!validatedMonths?.[mi]}
                />
              ))}
              <div style={{ padding:"7px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:T.accent, fontWeight:700, borderLeft:`1px solid ${T.rowBorder}` }}>{money ? finEur(finSum(r.values)) : finSum(r.values)}</div>
              {showPaymentStatus && (
                <div style={{ padding:"3px 4px", borderLeft:`1px solid ${T.rowBorder}` }}>
                  <select className="inv-sel" value={r.payment_status || ""} onChange={e=>updatePaymentStatus(ri,e.target.value)} style={{ width:"100%", padding:"4px 5px", fontSize:FONT.xs.size-1 }}>
                    <option value="">À qualifier</option>
                    <option value="regle">Réglé</option>
                    <option value="non_regle">Non réglé</option>
                    <option value="partiel">Partiel</option>
                  </select>
                </div>
              )}
              <button title="Supprimer" onClick={()=>removeRow(ri)} style={{ background:"transparent", border:"none", color:T.textMuted, cursor:"pointer", padding:3 }}><Icon as={Trash2} size={12}/></button>
            </div>
          ))}
          {showPaymentStatus ? (
            <>
              <div style={{ display:"grid", gridTemplateColumns:gridCols, background:"rgba(34,197,94,0.10)", borderTop:`1px solid ${T.accentBorder}`, alignItems:"center" }}>
                <div style={{ padding:"8px 8px", color:SU, fontWeight:800, fontSize:FONT.xs.size+1 }}>TOTAL RÉGLÉ</div>
                {paidTotals.map((v, i) => <div key={i} style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:SU, fontWeight:700, fontSize:FONT.xs.size }}>{money ? finEur(v) : v}</div>)}
                <div style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:SU, fontWeight:800, fontSize:FONT.xs.size }}>{money ? finEur(finSum(paidTotals)) : finSum(paidTotals)}</div>
                <div />
                <div />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:gridCols, background:"rgba(245,158,11,0.08)", borderTop:`1px solid ${T.rowBorder}`, alignItems:"center" }}>
                <div style={{ padding:"8px 8px", color:WA, fontWeight:800, fontSize:FONT.xs.size+1 }}>NON RÉGLÉ / À ENCAISSER</div>
                {unpaidTotals.map((v, i) => <div key={i} style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:WA, fontWeight:700, fontSize:FONT.xs.size }}>{money ? finEur(v) : v}</div>)}
                <div style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:WA, fontWeight:800, fontSize:FONT.xs.size }}>{money ? finEur(finSum(unpaidTotals)) : finSum(unpaidTotals)}</div>
                <div />
                <div />
              </div>
            </>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:gridCols, background:T.accentBg, borderTop:`1px solid ${T.accentBorder}`, alignItems:"center" }}>
              <div style={{ padding:"8px 8px", color:T.accent, fontWeight:800, fontSize:FONT.xs.size+1 }}>TOTAL</div>
              {totals.map((v, i) => <div key={i} style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:700, fontSize:FONT.xs.size }}>{money ? finEur(v) : v}</div>)}
              <div style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800, fontSize:FONT.xs.size }}>{money ? finEur(finSum(totals)) : finSum(totals)}</div>
              <div />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuiviTvaAutoTable({ rows, T, validatedMonths=null }) {
  const totals = finRowsSum(rows);
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className="inv-card-hd blue"><span>TVA déductible automatique · TOM sans TVA</span></div>
      <div className="inv-card-bd" style={{ padding:0, overflowX:"auto" }}>
        <div style={{ width:"100%", minWidth:920 }}>
          <div style={{ display:"grid", gridTemplateColumns:`minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) 26px`, background:T.sectionHd }}>
            <div style={{ padding:"8px", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size }}>Poste / taux</div>
            {SUIVI_FIN_MONTHS.map(m => <div key={m} style={{ padding:"8px 3px", textAlign:"right", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size-2 }}>{m}</div>)}
            <div style={{ padding:"8px 5px", textAlign:"right", color:T.accent, fontWeight:800, fontSize:FONT.xs.size }}>Total</div><div/>
          </div>
          {(rows || []).filter(r => finSum(r.values) !== 0).map((r, idx) => (
            <div key={r.id || idx} style={{ display:"grid", gridTemplateColumns:`minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) 26px`, borderBottom:`1px solid ${T.rowBorder}` }}>
              <div style={{ padding:"7px 8px", color:T.textSub, fontWeight:700, fontSize:FONT.xs.size+1 }}>{r.label} <span style={{color:T.accent}}>{r.rate === 0 ? "· Sans TVA" : `· ${r.rate}%`}</span></div>
              {SUIVI_FIN_MONTHS.map((m, mi) => <div key={m} style={{ padding:"7px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:T.textSub, background:validatedMonths?.[mi] ? "rgba(34,197,94,0.08)" : "transparent" }}>{finEur(r.values?.[mi])}</div>)}
              <div style={{ padding:"7px 5px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800, fontSize:FONT.xs.size }}>{finEur(finSum(r.values))}</div><div/>
            </div>
          ))}
          <div style={{ display:"grid", gridTemplateColumns:`minmax(145px,1.35fr) repeat(${SUIVI_FIN_MONTHS.length}, minmax(38px,.65fr)) minmax(62px,.75fr) 26px`, background:T.accentBg }}>
            <div style={{ padding:"8px", color:T.accent, fontWeight:800 }}>TOTAL TVA DÉDUCTIBLE</div>
            {totals.map((v,i)=><div key={i} style={{padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:700, fontSize:FONT.xs.size, background:validatedMonths?.[i] ? "rgba(34,197,94,0.08)" : "transparent"}}>{finEur(v)}</div>)}
            <div style={{padding:"8px 5px", textAlign:"right", fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800, fontSize:FONT.xs.size}}>{finEur(finSum(totals))}</div><div/>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuiviFinancier({ profil, T=THEMES_INV.dark }) {
  const [data, setData] = useState(() => cloneSuiviFinancier());
  const [tab, setTab] = useState("synthese");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const saveRef = useRef(null);
  const calc = calcSuiviFinancier(data);
  const params = data.params || {};

  const loadData = useCallback(async () => {
    setLoading(true); setError("");
    const [suiviRes, clientsRes] = await Promise.all([
      supabase.from("invest_suivi_financier").select("data").eq("id", "global").maybeSingle(),
      supabase.from("invest_clients").select("id,nom,prenom,email,statut,date_signature,created_at")
    ]);
    const { data: row, error } = suiviRes;
    if (error) {
      console.warn("Suivi financier non chargé:", error);
      setError("La table invest_suivi_financier n'est pas encore disponible. Lance la migration SQL fournie, puis recharge la page.");
    }
    const baseRaw = row?.data
      ? { ...cloneSuiviFinancier(), ...row.data, params: { ...cloneSuiviFinancier().params, ...(row.data.params || {}) } }
      : cloneSuiviFinancier();
    const base = finPruneLegacyRows(baseRaw);
    const merged = finMergeSignedClients(base, clientsRes.data || []);
    setData(merged);
    if (JSON.stringify(merged) !== JSON.stringify(base)) {
      await supabase.from("invest_suivi_financier").upsert({
        id:"global",
        data: merged,
        updated_at: new Date().toISOString(),
        updated_by: profil?.email || profil?.nom || null,
      });
    }
    setLoading(false);
  }, [profil]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => () => { if (saveRef.current) clearTimeout(saveRef.current); }, []);

  const sauvegarder = useCallback(async (payload = data, silent=false) => {
    setSaving(true); setError("");
    const { error } = await supabase.from("invest_suivi_financier").upsert({
      id:"global",
      data: payload,
      updated_at: new Date().toISOString(),
      updated_by: profil?.email || profil?.nom || null,
    });
    setSaving(false);
    if (error) {
      console.error("Erreur sauvegarde suivi financier", error);
      setError("Impossible d'enregistrer le suivi financier : " + (error.message || "erreur Supabase"));
      return;
    }
    if (!silent) { setSaved(true); setTimeout(()=>setSaved(false), 1800); }
  }, [data, profil]);

  const scheduleSave = useCallback((next) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => sauvegarder(next, true), 900);
  }, [sauvegarder]);

  const updateParam = (key, value) => {
    const next = JSON.parse(JSON.stringify(data));
    next.params = { ...(next.params || {}), [key]: finNum(value) };
    setData(next); scheduleSave(next);
  };

  const toggleDecaissementValidation = (monthIdx) => {
    const next = JSON.parse(JSON.stringify(data));
    next.finance = next.finance || {};
    next.finance.validatedMonths = Array.isArray(next.finance.validatedMonths) ? next.finance.validatedMonths : SUIVI_FIN_MONTHS.map(() => false);
    next.finance.validatedMonths[monthIdx] = !next.finance.validatedMonths[monthIdx];
    setData(next); scheduleSave(next);
  };

  const DecaissementsValidationBar = () => {
    const validated = data.finance?.validatedMonths || [];
    return (
      <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
        <div className="inv-card-hd green"><span>Validation des décaissements</span></div>
        <div className="inv-card-bd" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(76px,1fr))", gap:6 }}>
          {SUIVI_FIN_MONTHS.map((m, i) => {
            const ok = !!validated[i];
            return (
              <button key={m} className="inv-btn inv-btn-sm" onClick={() => toggleDecaissementValidation(i)}
                style={{ justifyContent:"center", background:ok ? "rgba(34,197,94,0.14)" : T.input, color:ok ? SU : T.textSub, border:`1px solid ${ok ? "rgba(34,197,94,0.35)" : T.border}` }}>
                {ok ? "✓ " : ""}{m}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const exportCsv = () => {
    const lines = [["Indicateur", ...SUIVI_FIN_MONTHS, "Total"]];
    const add = (label, arr) => lines.push([label, ...arr.map(v => finNum(v).toFixed(2)), finSum(arr).toFixed(2)]);
    add("CA HT réglé", calc.ca); add("CA HT non réglé", calc.caNonRegle); add("CA HT saisi", calc.caSaisi); add("Charges fixes", calc.chargesFixes); add("Charges variables", calc.chargesVariables); add("Décaissements TTC", calc.decaissements); add("Marge brute", calc.margeBrute); add("Résultat avant IS", calc.rnAvantIS); add("Résultat après IS", calc.rnApresIS); add("TVA nette", calc.tvaNette); add("Trésorerie fin de mois", calc.treso);
    const csv = lines.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "suivi-financier-profero-invest.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const totalCA = finSum(calc.ca);
  const totalCANonRegle = finSum(calc.caNonRegle);
  const totalCASaisi = finSum(calc.caSaisi);
  const totalDec = finSum(calc.decaissements);
  const totalRN = finSum(calc.rnApresIS);
  const tauxMargeAnnuel = finPct(finSum(calc.margeBrute), totalCA);
  const tauxRNAnnuel = finPct(totalRN, totalCA);
  const tresoActuelle = finLastNonZero(calc.treso);
  const objectifCA = finNum(params.objectifCA || 100000);
  const objectifTreso = finNum(params.objectifTreso || 30000);

  const SummaryTable = () => (
    <div className="inv-card">
      <div className="inv-card-hd blue"><span style={{display:"inline-flex",alignItems:"center",gap:6}}><Icon as={BarChart3} size={13}/>Synthèse mensuelle calculée</span></div>
      <div className="inv-card-bd" style={{ padding:0, overflowX:"auto" }}>
        <div style={{ width:"100%", minWidth:980 }}>
          <div style={{ display:"grid", gridTemplateColumns:`minmax(170px,1.5fr) repeat(4,minmax(52px,.75fr)) minmax(78px,.9fr) repeat(${SUIVI_FIN_MONTHS.length-4},minmax(52px,.75fr)) minmax(82px,.95fr)`, background:T.sectionHd, borderBottom:`1px solid ${T.border}` }}>
            <div style={{ padding:"8px 9px", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size, textTransform:"uppercase" }}>Indicateur</div>
            {SUIVI_FIN_MONTHS.flatMap((m,i)=> i===SUIVI_FIN_BILAN1_END_INDEX ? [<div key={m} style={{padding:"8px 3px", textAlign:"right", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size-2}}>{m}</div>, <div key="bilan_header" style={{padding:"8px 4px", textAlign:"right", color:T.accent, background:T.accentBg, fontWeight:900, fontSize:FONT.xs.size-2}}>Bilan N°1</div>] : [<div key={m} style={{padding:"8px 3px", textAlign:"right", color:T.textMuted, fontWeight:800, fontSize:FONT.xs.size-2}}>{m}</div>])}
            <div style={{ padding:"8px 5px", textAlign:"right", color:T.accent, fontWeight:900, fontSize:FONT.xs.size-2 }}>Total annuel</div>
          </div>
          {[
            ["CA HT réglé", calc.ca, "green"],
            ["CA HT non réglé", calc.caNonRegle, "orange"],
            ["CA HT saisi", calc.caSaisi, "accent"],
            ["Charges fixes", calc.chargesFixes, ""],
            ["Charges variables", calc.chargesVariables, ""],
            ["Décaissements TTC", calc.decaissements, "orange"],
            ["Marge brute", calc.margeBrute, "green"],
            ["Taux marge brute", calc.tauxMarge, "pct"],
            ["Résultat avant IS", calc.rnAvantIS, "green"],
            ["IS estimé", calc.impotIS, "orange"],
            ["Résultat après IS", calc.rnApresIS, "green"],
            ["Trésorerie fin de mois", calc.treso, "accent"],
            ["TVA nette à payer", calc.tvaNette, "orange"],
          ].map((row, ri) => (
            <div key={row[0]} style={{ display:"grid", gridTemplateColumns:`minmax(170px,1.5fr) repeat(4,minmax(52px,.75fr)) minmax(78px,.9fr) repeat(${SUIVI_FIN_MONTHS.length-4},minmax(52px,.75fr)) minmax(82px,.95fr)`, borderBottom:`1px solid ${T.rowBorder}`, background:ri===0?T.accentBg:"transparent" }}>
              <div style={{ padding:"9px 12px", color:ri===0?T.accent:T.textSub, fontWeight:800, fontSize:FONT.sm.size }}>{row[0]}</div>
              {row[1].flatMap((v, i) => { const cell = <div key={i} style={{ padding:"8px 4px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:row[2]==="orange"?WA:row[2]==="green"?SU:row[2]==="accent"?T.accent:T.textSub }}>{row[2]==="pct" ? finPctFmt(v) : finEur(v)}</div>; if (i===SUIVI_FIN_BILAN1_END_INDEX) { const bv = row[2]==="pct" ? finPct(finBilan1(calc.margeBrute), finBilan1(calc.ca)) : finBilan1(row[1]); return [cell, <div key="bilan1" style={{ padding:"8px 5px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:FONT.xs.size, color:T.accent, fontWeight:800, background:T.accentBg }}>{row[2]==="pct" ? finPctFmt(bv) : finEur(bv)}</div>]; } return [cell]; })}
              <div style={{ padding:"9px 7px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontWeight:800, color:T.accent, fontSize:FONT.xs.size }}>{row[2]==="pct" ? finPctFmt(finPct(finSum(calc.margeBrute.slice(4)), finSum(calc.ca.slice(4)))) : finEur(finTotalAnnuel(row[1]))}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) return <div style={{ padding:40, color:T.textMuted }}>Chargement du suivi financier…</div>;

  return (
    <div style={{ padding:`${SPACING.xl}px ${SPACING.xl+4}px`, maxWidth:1600, margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:SPACING.md, marginBottom:SPACING.xl, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:SPACING.md }}>
          <div style={{ width:48, height:48, borderRadius:RADIUS.lg, background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center" }}><Icon as={Euro} size={24}/></div>
          <div>
            <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Suivi financier</div>
            <div style={{ fontSize:FONT.sm.size+1, color:T.textSub, marginTop:2 }}>Reprise du fichier Excel : suivi commercial, encaissements, décaissements, TVA automatique et résultat</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:SPACING.sm, alignItems:"center", flexWrap:"wrap" }}>
          {saving && <span style={{ fontSize:FONT.xs.size, color:T.textMuted }}>Sync…</span>}
          {saved && <span style={{ fontSize:FONT.xs.size, color:SU, fontWeight:700 }}>Sauvegardé</span>}
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={exportCsv}><Icon as={Download} size={12}/> Export CSV</button>
          <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={()=>sauvegarder(data)}><Icon as={Save} size={12}/> Enregistrer</button>
        </div>
      </div>

      {error && <div style={{ marginBottom:SPACING.md, padding:"10px 12px", borderRadius:RADIUS.md, border:`1px solid ${SEMANTIC.warning.border}`, background:SEMANTIC.warning.bg, color:WA, fontSize:FONT.sm.size+1 }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:SPACING.md, marginBottom:SPACING.xl }}>
        <FinKPI T={T} icon={Euro} label="CA HT total réglé" value={finEur(totalCA)} sub={`Objectif : ${finEur(objectifCA)} · ${finPctFmt(finPct(totalCA, objectifCA))}`} color={SU} />
        <FinKPI T={T} icon={Wallet} label="CA HT non réglé" value={finEur(totalCANonRegle)} sub={`CA HT saisi : ${finEur(totalCASaisi)}`} color={WA} />
        <FinKPI T={T} icon={Wallet} label="Décaissements" value={finEur(totalDec)} sub="Charges fixes + variables" color={WA} />
        <FinKPI T={T} icon={TrendingUp} label="Résultat après IS" value={finEur(totalRN)} sub={`Taux net : ${finPctFmt(tauxRNAnnuel)}`} color={totalRN >= 0 ? SU : DA} />
        <FinKPI T={T} icon={BarChart3} label="Marge brute" value={finPctFmt(tauxMargeAnnuel)} sub={finEur(finSum(calc.margeBrute))} color={T.accent} />
        <FinKPI T={T} icon={Wallet} label="Trésorerie actuelle" value={finEur(tresoActuelle)} sub={`Objectif : ${finEur(objectifTreso)}`} color={tresoActuelle >= objectifTreso ? SU : "#4db8ff"} />
        <FinKPI T={T} icon={FileText} label="TVA nette" value={finEur(finSum(calc.tvaNette))} sub="Collectée - déductible auto · TOM sans TVA" color="#c084fc" />
      </div>

      <div className="inv-tab-nav" style={{ marginBottom:SPACING.lg, borderRadius:RADIUS.xl, overflow:"hidden", border:`1px solid ${T.border}` }}>
        {[["synthese","Synthèse"],["commercial","Commercial & encaissements"],["decaissements","Décaissements"],["params","Paramètres"]].map(([k,l]) => (
          <button key={k} className={`inv-tab-btn${tab===k?" active":""}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "synthese" && <SummaryTable />}
      {tab === "commercial" && <>
        <SuiviFinanceTable title="Pipeline commercial" rows={data.commercial?.pipeline || []} sectionPath="commercial.pipeline" data={data} setData={setData} scheduleSave={scheduleSave} T={T} canAdd={false} money={false} />
        <SuiviFinanceTable title="Encaissements — Forfaits clients HT" rows={data.commercial?.forfaits || []} sectionPath="commercial.forfaits" data={data} setData={setData} scheduleSave={scheduleSave} T={T} showPaymentStatus />
        <SuiviFinanceTable title="Encaissements — Honoraires négociation HT" rows={data.commercial?.negociation || []} sectionPath="commercial.negociation" data={data} setData={setData} scheduleSave={scheduleSave} T={T} showPaymentStatus />
        <SuiviFinanceTable title="Autres encaissements HT" rows={data.commercial?.autres || []} sectionPath="commercial.autres" data={data} setData={setData} scheduleSave={scheduleSave} T={T} showPaymentStatus />
      </>}
      {tab === "decaissements" && <>
        <DecaissementsValidationBar />
        <SuiviFinanceTable title="Charges fixes récurrentes" rows={data.finance?.chargesFixes || []} sectionPath="finance.chargesFixes" data={data} setData={setData} scheduleSave={scheduleSave} T={T} validatedMonths={data.finance?.validatedMonths || []} />
        <SuiviFinanceTable title="Charges variables opérationnelles" rows={data.finance?.chargesVariables || []} sectionPath="finance.chargesVariables" data={data} setData={setData} scheduleSave={scheduleSave} T={T} validatedMonths={data.finance?.validatedMonths || []} />
        <SuiviTvaAutoTable rows={calc.tvaDeductibleRows || []} T={T} validatedMonths={data.finance?.validatedMonths || []} />
      </>}
      {tab === "params" && (
        <div className="inv-card">
          <div className="inv-card-hd blue"><span>Paramètres de pilotage</span></div>
          <div className="inv-card-bd" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:SPACING.md }}>
            {[["tauxIS","Taux IS (%)"],["tvaCollecteePct","TVA collectée (%)"],["tresoDepart","Trésorerie de départ"],["objectifTreso","Objectif trésorerie"],["objectifCA","Objectif CA HT"],["forfaitFixeHT","Forfait fixe HT / client"],["commissionPctGain","Commission sur gain négo (%)"]].map(([key,label]) => (
              <div key={key}>
                <label style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2, fontWeight:800, display:"block", marginBottom:5 }}>{label}</label>
                <input className="inv-inp" type="number" value={params[key] ?? ""} onChange={e=>updateParam(key,e.target.value)} style={{ width:"100%" }}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── STRUCTURATION PATRIMONIALE ─────────────────────────────────────────────

export default SuiviFinancier;
export { SuiviFinancier };
