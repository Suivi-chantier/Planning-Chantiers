# scripts/split-invest.ps1
# Découpe src/PageInvest.jsx (~12500 lignes) en fichiers par page dans src/Invest/.
# À exécuter UNE fois depuis la racine du projet : `powershell -File scripts/split-invest.ps1`.
# Idempotent : peut être ré-exécuté, il écrase les fichiers générés.

$ErrorActionPreference = "Stop"

$srcPath = "src\PageInvest.jsx"
$dstDir  = "src\Invest"

$raw = Get-Content -LiteralPath $srcPath -Raw -Encoding UTF8
# Préserver les fins de ligne LF (le fichier source est en LF)
$lines = $raw -split "`n"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Helper : extrait [start..end] inclusifs (1-indexed lines)
function Slice([int]$start, [int]$end) {
  return ($lines[($start - 1)..($end - 1)] -join "`n")
}

# Helper : concatène plusieurs slices
function Slices([int[][]]$ranges) {
  $parts = foreach ($r in $ranges) { Slice $r[0] $r[1] }
  return ($parts -join "`n`n")
}

# ─── HEADER COMMUN (adapté avec ../ pour fichiers en src/Invest/) ────────────
$commonHeader = @"
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
"@

# Liste de TOUS les noms exportés par _shared.js (utilisée pour les imports
# en tête de chaque fichier de page — on importe largement, le bundler trie).
$sharedNames = @(
  "INVEST_ACC",
  "LOT_TYPES","NIVEAUX","MAX_LOTS","GESTION_PRICES","DEFAULT_LOTS","BUDGET_SECTIONS","COMP_FISCA",
  "pmt","fmt","fmtPct","fmtMois","actLots","initBudgetState",
  "openFicheClientInvestisseurPDF",
  "THEMES_INV","SU","WA","DA","IN","getCSS","CSS",
  "NumInput",
  "ETAPES_CLIENT","TYPES_PLANNING_INVEST",
  "isoDate","getWeekRange","isActionLateOrThisWeek","normTxt",
  "compareValues","SortableHeader","KPICard",
  "DASH_STAGE_COLORS","fmtDashboardEur","fmtDashboardPct","safeDate","daysBetween",
  "isFilledDash","getClientName","getBienLabel","getBienScore",
  "isBienFicheComplete","hasSimulateurBien","isGeolocBien",
  "CLIENT_STRATEGIES_INVEST","CLIENT_TRAVAUX_ACCEPTES","CLIENT_URGENCE_INVEST",
  "CLIENT_FISCALITES_INVEST","OFFRE_STATUTS_INVEST",
  "CLIENT_DOCUMENT_CHECKLIST","BIEN_DOCUMENT_CHECKLIST",
  "emptyClientStrategy","clientStrategy","checklistPct","getNumberLoose",
  "bienTotalCost","bienLotsCount","computeAutoBienScore","computeClientBienMatch",
  "DashboardPanel","DashboardAlertList",
  "FILE_ICONS","DOCUMENT_CATEGORIES_BIEN",
  "GOOGLE_DRIVE_API_KEY","GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_APP_ID","GOOGLE_DRIVE_SCOPE","GOOGLE_DRIVE_LINKS_TABLE",
  "getGoogleDriveConfig","GOOGLE_DRIVE_SCRIPT_PROMISES","loadExternalScriptOnce",
  "GOOGLE_DRIVE_FOLDER_MIME","GOOGLE_DRIVE_SHORTCUT_MIME",
  "isGoogleDriveFolderMime","isGoogleDriveShortcutMime",
  "getDriveEffectiveId","getDriveEffectiveMimeType",
  "isGoogleDriveFolderItem","isGoogleDriveShortcutItem",
  "getDriveUrlForDoc","normalizeDriveDoc","getFileIcon","fmtSize",
  "GoogleDriveLinksSection","DocumentsSection"
)

$sharedImport = "import {`n  " + ($sharedNames -join ", ") + "`n} from `"./_shared`";"

# ════════════════════════════════════════════════════════════════════════════
# 1) src/Invest/_shared.js
# ════════════════════════════════════════════════════════════════════════════
$sharedRanges = @(
  ,@(16, 526)    # INVEST_ACC + augmentations PAGES_INVEST + constants + openFichePDF + THEMES_INV + getCSS + CSS + NumInput
  ,@(1855, 1955) # ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard (s'arrête avant DASH_CLIENT_STATUS_CONFIG)
  ,@(2084, 2214) # DASH_STAGE_COLORS + helpers + CLIENT_STRATEGIES_INVEST + computeAutoBienScore + computeClientBienMatch
  ,@(2961, 3007) # DashboardPanel, DashboardAlertList
  ,@(4446, 5469) # Drive constants + helpers + GoogleDriveLinksSection + DocumentsSection
)
$sharedExportBlock = "export {`n  " + ($sharedNames -join ",`n  ") + ",`n};`n"
$sharedContent = $commonHeader + "`n`n" + (Slices $sharedRanges) + "`n`n" + $sharedExportBlock
[System.IO.File]::WriteAllText("$dstDir\_shared.js", $sharedContent, $utf8NoBom)
Write-Output ("_shared.js : " + ($sharedContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 2) src/Invest/Simulateur.jsx — ListeProjets + Simulateur
# ════════════════════════════════════════════════════════════════════════════
$simulateurContent = $commonHeader + "`n`n" + $sharedImport + "`n`n" + (Slice 526 1854) + "`n`n" + @"
export { Simulateur, ListeProjets };
export default Simulateur;
"@
[System.IO.File]::WriteAllText("$dstDir\Simulateur.jsx", $simulateurContent, $utf8NoBom)
Write-Output ("Simulateur.jsx : " + ($simulateurContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 3) src/Invest/Dashboard.jsx — TableauBord + sous-composants Dashboard
# ════════════════════════════════════════════════════════════════════════════
$dashboardRanges = @(
  ,@(1956, 2083) # DASH_CLIENT_STATUS_CONFIG + DASH_STAT_KEY + ClientsStatutsBoard
  ,@(2922, 2960) # DossiersRelanceDashboard + HONORAIRE + DirectionPilotageDashboard
  ,@(3008, 3208) # ActionsPrioritairesDashboard, OpportunitesChaudesDashboard, StockPilotageDashboard, PipelineEtapesBoard, ClientsARisqueDashboard, PerformanceCommercialeDashboard, ValeurBusinessDashboard
  ,@(3761, 4138) # PlanningSemaine + TableauBord (s'arrête avant STATUTS_CLIENT)
  ,@(6468, 6550) # MissionActionsCollaborateursDashboard
)
$dashboardContent = $commonHeader + "`n`n" + $sharedImport + "`n`n" + (Slices $dashboardRanges) + "`n`n" + @"
export default TableauBord;
export {
  TableauBord, PlanningSemaine, ClientsStatutsBoard,
  DossiersRelanceDashboard, DirectionPilotageDashboard,
  ActionsPrioritairesDashboard, OpportunitesChaudesDashboard, StockPilotageDashboard,
  PipelineEtapesBoard, ClientsARisqueDashboard,
  PerformanceCommercialeDashboard, ValeurBusinessDashboard,
  MissionActionsCollaborateursDashboard,
};
"@
[System.IO.File]::WriteAllText("$dstDir\Dashboard.jsx", $dashboardContent, $utf8NoBom)
Write-Output ("Dashboard.jsx : " + ($dashboardContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 4) src/Invest/CRM.jsx — CRM + FormulaireClient + FicheClient + Mission card
# ════════════════════════════════════════════════════════════════════════════
$crmRanges = @(
  ,@(2215, 2324) # CompletionBar, ClientStrategyCard, MatchingBiensClientCard, ChecklistDocumentsClientCard
  ,@(2454, 2499) # computeClientPriorityScore, ClientScoreCard
  ,@(4139, 4445) # STATUTS_CLIENT etc. + CRM + FormulaireClient (s'arrête avant FILE_ICONS)
  ,@(5472, 6467) # MISSION_* constants + helpers + MissionParcoursClientCard
  ,@(6551, 6842) # FicheClient (s'arrête avant STATUTS_BIEN)
)
$crmHeader = $commonHeader + "`n`n" + $sharedImport + "`n" + @"
import Simulateur from "./Simulateur";
"@
$crmContent = $crmHeader + "`n`n" + (Slices $crmRanges) + "`n`n" + @"
export default CRM;
export { CRM, FormulaireClient, FicheClient, MissionParcoursClientCard };
"@
[System.IO.File]::WriteAllText("$dstDir\CRM.jsx", $crmContent, $utf8NoBom)
Write-Output ("CRM.jsx : " + ($crmContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 5) src/Invest/Biens.jsx — StockBiens + FicheBien + FicheVisiteBien + cartes
# ════════════════════════════════════════════════════════════════════════════
$biensRanges = @(
  ,@(2325, 2453) # AutoScoreBienCard, MatchingClientsBienCard, OffreAchatBienCard, ChecklistDocumentsBienCard, HistoriqueBienCard
  ,@(2500, 2921) # buildQuickBienAnalysis + AnalyseRapideBienCard + MODE_VISITE_TERRAIN + ModeVisiteTerrainCard + VISITE_TERRAIN_* + normaliseModeVisiteTerrain + ModeVisiteTerrainOnglet
  ,@(6843, 9158) # STATUTS_BIEN, STATUT_BIEN_COLORS, GOOGLE_MAPS_*, Maps helpers, CarteBiens, StockBiens, InpText, InpNum, FormulaireBien, VISITE_STATUS constants, TECHNIQUE_VISITE_GROUPS, URBANISME_VISITE_ITEMS, RISQUES_VISITE_ITEMS, makeAuditDefaults, emptyLotCible, emptyLotsCibles, deepMergeVisite, buildDefaultVisiteData, normaliseVisiteData, numVal, MiniField, VisitSection, AuditRows, FicheVisiteBien, mapping helpers, FicheBien
)
$biensHeader = $commonHeader + "`n`n" + $sharedImport + "`n" + @"
import Simulateur from "./Simulateur";
"@
$biensContent = $biensHeader + "`n`n" + (Slices $biensRanges) + "`n`n" + @"
export default StockBiens;
export { StockBiens, FicheBien, FormulaireBien, FicheVisiteBien, CarteBiens };
"@
[System.IO.File]::WriteAllText("$dstDir\Biens.jsx", $biensContent, $utf8NoBom)
Write-Output ("Biens.jsx : " + ($biensContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 6) src/Invest/Finance.jsx — DashboardFinancier + ses helpers
# ════════════════════════════════════════════════════════════════════════════
$financeContent = $commonHeader + "`n`n" + $sharedImport + "`n`n" + (Slice 3209 3760) + "`n`n" + @"
export default DashboardFinancier;
export { DashboardFinancier };
"@
[System.IO.File]::WriteAllText("$dstDir\Finance.jsx", $financeContent, $utf8NoBom)
Write-Output ("Finance.jsx : " + ($financeContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 7) src/Invest/Admin.jsx — AdminInvest + OngletUtilisateursInvest
# ════════════════════════════════════════════════════════════════════════════
$adminContent = $commonHeader + "`n`n" + $sharedImport + "`n`n" + (Slice 9159 9510) + "`n`n" + @"
export default AdminInvest;
export { AdminInvest, OngletUtilisateursInvest };
"@
[System.IO.File]::WriteAllText("$dstDir\Admin.jsx", $adminContent, $utf8NoBom)
Write-Output ("Admin.jsx : " + ($adminContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 8) src/Invest/SuiviFinancier.jsx — SuiviFinancier + ses helpers
# ════════════════════════════════════════════════════════════════════════════
$suiviContent = $commonHeader + "`n`n" + $sharedImport + "`n`n" + (Slice 9513 11204) + "`n`n" + @"
export default SuiviFinancier;
export { SuiviFinancier };
"@
[System.IO.File]::WriteAllText("$dstDir\SuiviFinancier.jsx", $suiviContent, $utf8NoBom)
Write-Output ("SuiviFinancier.jsx : " + ($suiviContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 9) src/Invest/Structuration.jsx — StructurationPatrimoniale + ses helpers
# ════════════════════════════════════════════════════════════════════════════
$structContent = $commonHeader + "`n`n" + $sharedImport + "`n`n" + (Slice 11205 12203) + "`n`n" + @"
export default StructurationPatrimoniale;
export { StructurationPatrimoniale };
"@
[System.IO.File]::WriteAllText("$dstDir\Structuration.jsx", $structContent, $utf8NoBom)
Write-Output ("Structuration.jsx : " + ($structContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 10) src/Invest/PageInvest.jsx — SidebarInvest + AccesRefuseInvest + PageInvest (routeur)
# ════════════════════════════════════════════════════════════════════════════
$pageInvestHeader = $commonHeader + "`n`n" + $sharedImport + "`n" + @"
import TableauBord from "./Dashboard";
import CRM from "./CRM";
import StockBiens from "./Biens";
import DashboardFinancier from "./Finance";
import SuiviFinancier from "./SuiviFinancier";
import StructurationPatrimoniale from "./Structuration";
import AdminInvest from "./Admin";
import Simulateur, { ListeProjets } from "./Simulateur";
"@
$pageInvestContent = $pageInvestHeader + "`n`n" + (Slice 12204 12498) + "`n"
[System.IO.File]::WriteAllText("$dstDir\PageInvest.jsx", $pageInvestContent, $utf8NoBom)
Write-Output ("PageInvest.jsx (routeur) : " + ($pageInvestContent -split "`n").Length + " lignes")

# ════════════════════════════════════════════════════════════════════════════
# 11) src/PageInvest.jsx — devient un SHIM qui réexporte depuis ./Invest/PageInvest
# ════════════════════════════════════════════════════════════════════════════
$shim = @"
// Shim : ce fichier est conservé pour ne pas casser les imports existants.
// La vraie implémentation est dans src/Invest/PageInvest.jsx et chaque page
// Invest a maintenant son propre fichier dans src/Invest/.
export { default } from "./Invest/PageInvest";
"@
[System.IO.File]::WriteAllText("src\PageInvest.jsx", $shim, $utf8NoBom)
Write-Output "src\PageInvest.jsx : shim créé"

Write-Output "`n=== Découpage terminé ==="
Get-ChildItem -Path $dstDir -File | Select-Object Name, @{N="Lines";E={(Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines}} | Format-Table -AutoSize
