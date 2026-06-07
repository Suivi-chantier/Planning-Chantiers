import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import {
  Calculator,
  Euro,
  Clock,
  TrendingUp,
  Info,
  Save,
  Plus,
  Trash2,
  CalendarPlus,
  FileSpreadsheet,
  Lock,
  Unlock,
  GripVertical,
  UploadCloud,
  FileText,
  CheckCircle,
  AlertTriangle,
  CreditCard,
} from "lucide-react";

const KEY = "etats_financiers";

const MOIS = [
  { id: "01", label: "Janvier"   },
  { id: "02", label: "Février"   },
  { id: "03", label: "Mars"      },
  { id: "04", label: "Avril"     },
  { id: "05", label: "Mai"       },
  { id: "06", label: "Juin"      },
  { id: "07", label: "Juillet"   },
  { id: "08", label: "Août"      },
  { id: "09", label: "Septembre" },
  { id: "10", label: "Octobre"   },
  { id: "11", label: "Novembre"  },
  { id: "12", label: "Décembre"  },
];

const DEFAULT_AVANCEMENT = {
  "periods": [
    {
      "id": "2026-05-31",
      "label": "31/05/26"
    },
    {
      "id": "2026-04-30-corrige",
      "label": "30/04/26 corrigé"
    },
    {
      "id": "2026-04-30",
      "label": "30/04/26"
    },
    {
      "id": "2026-03-31",
      "label": "31/03/26"
    },
    {
      "id": "2026-02-28",
      "label": "28/02/26"
    },
    {
      "id": "2025-12-31",
      "label": "31/12/25"
    }
  ],
  "rows": [
    {
      "id": "av_001",
      "devis": "D-250023",
      "chantier": "BRIOLLAY - LOT 1",
      "values": {
        "2026-05-31": {
          "devis": "D-250023",
          "chantier": "BRIOLLAY - LOT 1",
          "montantHT": 22386.4,
          "montantTTC": 24625.04,
          "sourceRow": 3,
          "avancementPrecedent": 0.64,
          "avancementReel": 0.69,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": 0.01,
          "caProvisionner": 223.864
        },
        "2026-04-30-corrige": {
          "devis": "D-250023",
          "chantier": "BRIOLLAY - LOT 1",
          "montantHT": 22386.4,
          "montantTTC": 24625.04,
          "sourceRow": 3,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.64,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.04,
          "caProvisionner": -895.456
        },
        "2026-04-30": {
          "devis": "D-250023",
          "chantier": "BRIOLLAY - LOT 1",
          "montantHT": 22386.4,
          "montantTTC": 24625.04,
          "sourceRow": 3,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.64,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.04,
          "caProvisionner": -895.456
        },
        "2026-03-31": {
          "devis": "D-250023",
          "chantier": "BRIOLLAY - LOT 1",
          "montantHT": 22386.4,
          "montantTTC": 24625.04,
          "sourceRow": 3,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -4029.552
        },
        "2026-02-28": {
          "devis": "D-250023",
          "chantier": "BRIOLLAY - LOT 1",
          "montantHT": 22386.4,
          "montantTTC": 24625.04,
          "sourceRow": 3,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -4029.552
        },
        "2025-12-31": {
          "devis": "D-250023",
          "chantier": "BRIOLLAY - LOT 1",
          "montantHT": 22386.4,
          "montantTTC": 24625.04,
          "sourceRow": 3,
          "avancementPrecedent": "",
          "avancementReel": 0.5,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.5,
          "caProvisionner": 11193.2
        }
      }
    },
    {
      "id": "av_002",
      "devis": "D-250024",
      "chantier": "BRIOLLAY - LOT 2",
      "values": {
        "2026-05-31": {
          "devis": "D-250024",
          "chantier": "BRIOLLAY - LOT 2",
          "montantHT": 27175.27,
          "montantTTC": 29892.8,
          "sourceRow": 4,
          "avancementPrecedent": 0.52,
          "avancementReel": 0.6,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.08,
          "caProvisionner": -2174.0216
        },
        "2026-04-30-corrige": {
          "devis": "D-250024",
          "chantier": "BRIOLLAY - LOT 2",
          "montantHT": 27175.27,
          "montantTTC": 29892.8,
          "sourceRow": 4,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.52,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.16,
          "caProvisionner": -4348.0432
        },
        "2026-04-30": {
          "devis": "D-250024",
          "chantier": "BRIOLLAY - LOT 2",
          "montantHT": 27175.27,
          "montantTTC": 29892.8,
          "sourceRow": 4,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.52,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.16,
          "caProvisionner": -4348.0432
        },
        "2026-03-31": {
          "devis": "D-250024",
          "chantier": "BRIOLLAY - LOT 2",
          "montantHT": 27175.27,
          "montantTTC": 29892.8,
          "sourceRow": 4,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -4891.5486
        },
        "2026-02-28": {
          "devis": "D-250024",
          "chantier": "BRIOLLAY - LOT 2",
          "montantHT": 27175.27,
          "montantTTC": 29892.8,
          "sourceRow": 4,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -4891.5486
        },
        "2025-12-31": {
          "devis": "D-250024",
          "chantier": "BRIOLLAY - LOT 2",
          "montantHT": 27175.27,
          "montantTTC": 29892.8,
          "sourceRow": 4,
          "avancementPrecedent": "",
          "avancementReel": 0.5,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.5,
          "caProvisionner": 13587.635
        }
      }
    },
    {
      "id": "av_003",
      "devis": "D-250025",
      "chantier": "BRIOLLAY - LOT 3",
      "values": {
        "2026-05-31": {
          "devis": "D-250025",
          "chantier": "BRIOLLAY - LOT 3",
          "montantHT": 17312.4,
          "montantTTC": 19043.64,
          "sourceRow": 5,
          "avancementPrecedent": 0.52,
          "avancementReel": 0.55,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.13,
          "caProvisionner": -2250.612
        },
        "2026-04-30-corrige": {
          "devis": "D-250025",
          "chantier": "BRIOLLAY - LOT 3",
          "montantHT": 17312.4,
          "montantTTC": 19043.64,
          "sourceRow": 5,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.52,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.16,
          "caProvisionner": -2769.984
        },
        "2026-04-30": {
          "devis": "D-250025",
          "chantier": "BRIOLLAY - LOT 3",
          "montantHT": 17312.4,
          "montantTTC": 19043.64,
          "sourceRow": 5,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.52,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.16,
          "caProvisionner": -2769.984
        },
        "2026-03-31": {
          "devis": "D-250025",
          "chantier": "BRIOLLAY - LOT 3",
          "montantHT": 17312.4,
          "montantTTC": 19043.64,
          "sourceRow": 5,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -3116.232
        },
        "2026-02-28": {
          "devis": "D-250025",
          "chantier": "BRIOLLAY - LOT 3",
          "montantHT": 17312.4,
          "montantTTC": 19043.64,
          "sourceRow": 5,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -3116.232
        },
        "2025-12-31": {
          "devis": "D-250025",
          "chantier": "BRIOLLAY - LOT 3",
          "montantHT": 17312.4,
          "montantTTC": 19043.64,
          "sourceRow": 5,
          "avancementPrecedent": "",
          "avancementReel": 0.2,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.2,
          "caProvisionner": 3462.48
        }
      }
    },
    {
      "id": "av_004",
      "devis": "D-250026",
      "chantier": "BRIOLLAY - LOT 4",
      "values": {
        "2026-05-31": {
          "devis": "D-250026",
          "chantier": "BRIOLLAY - LOT 4",
          "montantHT": 16055.7,
          "montantTTC": 17661.27,
          "sourceRow": 6,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.54,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.14,
          "caProvisionner": -2247.798
        },
        "2026-04-30-corrige": {
          "devis": "D-250026",
          "chantier": "BRIOLLAY - LOT 4",
          "montantHT": 16055.7,
          "montantTTC": 17661.27,
          "sourceRow": 6,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2890.026
        },
        "2026-04-30": {
          "devis": "D-250026",
          "chantier": "BRIOLLAY - LOT 4",
          "montantHT": 16055.7,
          "montantTTC": 17661.27,
          "sourceRow": 6,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2890.026
        },
        "2026-03-31": {
          "devis": "D-250026",
          "chantier": "BRIOLLAY - LOT 4",
          "montantHT": 16055.7,
          "montantTTC": 17661.27,
          "sourceRow": 6,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2890.026
        },
        "2026-02-28": {
          "devis": "D-250026",
          "chantier": "BRIOLLAY - LOT 4",
          "montantHT": 16055.7,
          "montantTTC": 17661.27,
          "sourceRow": 6,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2890.026
        },
        "2025-12-31": {
          "devis": "D-250026",
          "chantier": "BRIOLLAY - LOT 4",
          "montantHT": 16055.7,
          "montantTTC": 17661.27,
          "sourceRow": 6,
          "avancementPrecedent": "",
          "avancementReel": 0.2,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.2,
          "caProvisionner": 3211.14
        }
      }
    },
    {
      "id": "av_005",
      "devis": "D-250027",
      "chantier": "BRIOLLAY - LOT 5",
      "values": {
        "2026-05-31": {
          "devis": "D-250027",
          "chantier": "BRIOLLAY - LOT 5",
          "montantHT": 15215.44,
          "montantTTC": 16736.98,
          "sourceRow": 7,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.51,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.17,
          "caProvisionner": -2586.6248
        },
        "2026-04-30-corrige": {
          "devis": "D-250027",
          "chantier": "BRIOLLAY - LOT 5",
          "montantHT": 15215.44,
          "montantTTC": 16736.98,
          "sourceRow": 7,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2738.7792
        },
        "2026-04-30": {
          "devis": "D-250027",
          "chantier": "BRIOLLAY - LOT 5",
          "montantHT": 15215.44,
          "montantTTC": 16736.98,
          "sourceRow": 7,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2738.7792
        },
        "2026-03-31": {
          "devis": "D-250027",
          "chantier": "BRIOLLAY - LOT 5",
          "montantHT": 15215.44,
          "montantTTC": 16736.98,
          "sourceRow": 7,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2738.7792
        },
        "2026-02-28": {
          "devis": "D-250027",
          "chantier": "BRIOLLAY - LOT 5",
          "montantHT": 15215.44,
          "montantTTC": 16736.98,
          "sourceRow": 7,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.5,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.18,
          "caProvisionner": -2738.7792
        },
        "2025-12-31": {
          "devis": "D-250027",
          "chantier": "BRIOLLAY - LOT 5",
          "montantHT": 15215.44,
          "montantTTC": 16736.98,
          "sourceRow": 7,
          "avancementPrecedent": "",
          "avancementReel": 0.2,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.2,
          "caProvisionner": 3043.088
        }
      }
    },
    {
      "id": "av_006",
      "devis": "D-250028",
      "chantier": "BRIOLLAY - LOT 6",
      "values": {
        "2026-05-31": {
          "devis": "D-250028",
          "chantier": "BRIOLLAY - LOT 6",
          "montantHT": 18593.14,
          "montantTTC": 20452.45,
          "sourceRow": 8,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -8924.7072
        },
        "2026-04-30-corrige": {
          "devis": "D-250028",
          "chantier": "BRIOLLAY - LOT 6",
          "montantHT": 18593.14,
          "montantTTC": 20452.45,
          "sourceRow": 8,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -8924.7072
        },
        "2026-04-30": {
          "devis": "D-250028",
          "chantier": "BRIOLLAY - LOT 6",
          "montantHT": 18593.14,
          "montantTTC": 20452.45,
          "sourceRow": 8,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -8924.7072
        },
        "2026-03-31": {
          "devis": "D-250028",
          "chantier": "BRIOLLAY - LOT 6",
          "montantHT": 18593.14,
          "montantTTC": 20452.45,
          "sourceRow": 8,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -8924.7072
        },
        "2026-02-28": {
          "devis": "D-250028",
          "chantier": "BRIOLLAY - LOT 6",
          "montantHT": 18593.14,
          "montantTTC": 20452.45,
          "sourceRow": 8,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -8924.7072
        },
        "2025-12-31": {
          "devis": "D-250028",
          "chantier": "BRIOLLAY - LOT 6",
          "montantHT": 18593.14,
          "montantTTC": 20452.45,
          "sourceRow": 8,
          "avancementPrecedent": "",
          "avancementReel": 0.2,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.2,
          "caProvisionner": 3718.628
        }
      }
    },
    {
      "id": "av_007",
      "devis": "D-250029",
      "chantier": "BRIOLLAY - LOT 7",
      "values": {
        "2026-05-31": {
          "devis": "D-250029",
          "chantier": "BRIOLLAY - LOT 7",
          "montantHT": 19553.69,
          "montantTTC": 21509.06,
          "sourceRow": 9,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -9385.7712
        },
        "2026-04-30-corrige": {
          "devis": "D-250029",
          "chantier": "BRIOLLAY - LOT 7",
          "montantHT": 19553.69,
          "montantTTC": 21509.06,
          "sourceRow": 9,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -9385.7712
        },
        "2026-04-30": {
          "devis": "D-250029",
          "chantier": "BRIOLLAY - LOT 7",
          "montantHT": 19553.69,
          "montantTTC": 21509.06,
          "sourceRow": 9,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -9385.7712
        },
        "2026-03-31": {
          "devis": "D-250029",
          "chantier": "BRIOLLAY - LOT 7",
          "montantHT": 19553.69,
          "montantTTC": 21509.06,
          "sourceRow": 9,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.71,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -9385.7712
        },
        "2026-02-28": {
          "devis": "D-250029",
          "chantier": "BRIOLLAY - LOT 7",
          "montantHT": 19553.69,
          "montantTTC": 21509.06,
          "sourceRow": 9,
          "avancementPrecedent": 0.2,
          "avancementReel": 0.2,
          "pctFacture": 0.68,
          "acompteMois": 0.71,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.48,
          "caProvisionner": -9385.7712
        },
        "2025-12-31": {
          "devis": "D-250029",
          "chantier": "BRIOLLAY - LOT 7",
          "montantHT": 19553.69,
          "montantTTC": 21509.06,
          "sourceRow": 9,
          "avancementPrecedent": "",
          "avancementReel": 0.2,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.2,
          "caProvisionner": 3910.738
        }
      }
    },
    {
      "id": "av_008",
      "devis": "D-250018",
      "chantier": "CAP INVEST / CO-LIVING",
      "values": {
        "2026-05-31": {
          "devis": "D-250018",
          "chantier": "CAP INVEST / CO-LIVING",
          "montantHT": 32650.17,
          "montantTTC": 35915.19,
          "sourceRow": 11,
          "avancementPrecedent": 0.98,
          "avancementReel": 0.98,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.43,
          "caProvisionner": 14039.5731
        },
        "2026-04-30-corrige": {
          "devis": "D-250018",
          "chantier": "CAP INVEST / CO-LIVING",
          "montantHT": 32650.17,
          "montantTTC": 35915.19,
          "sourceRow": 11,
          "avancementPrecedent": 0.98,
          "avancementReel": 0.98,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.43,
          "caProvisionner": 14039.5731
        },
        "2026-04-30": {
          "devis": "D-250018",
          "chantier": "CAP INVEST / CO-LIVING",
          "montantHT": 32650.17,
          "montantTTC": 35915.19,
          "sourceRow": 11,
          "avancementPrecedent": 0.98,
          "avancementReel": 0.98,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.43,
          "caProvisionner": 14039.5731
        },
        "2026-03-31": {
          "devis": "D-250018",
          "chantier": "CAP INVEST / CO-LIVING",
          "montantHT": 32650.17,
          "montantTTC": 35915.19,
          "sourceRow": 11,
          "avancementPrecedent": 0.98,
          "avancementReel": 0.98,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.43,
          "caProvisionner": 14039.5731
        },
        "2026-02-28": {
          "devis": "D-250018",
          "chantier": "CAP INVEST / CO-LIVING",
          "montantHT": 32650.17,
          "montantTTC": 35915.19,
          "sourceRow": 11,
          "avancementPrecedent": 1,
          "avancementReel": 0.98,
          "pctFacture": 0.49,
          "acompteMois": 0.69,
          "acomptePrecedent": 1,
          "note": "",
          "pctProvisionner": 0.49,
          "caProvisionner": 15998.5833
        },
        "2025-12-31": {
          "devis": "D-250018",
          "chantier": "CO-LIVING",
          "montantHT": 32650.17,
          "montantTTC": 35915.19,
          "sourceRow": 12,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 1,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_009",
      "devis": "D-250017",
      "chantier": "CAP INVEST / LOT 102",
      "values": {
        "2026-05-31": {
          "devis": "D-250017",
          "chantier": "CAP INVEST / LOT 102",
          "montantHT": 16957.65,
          "montantTTC": 18653.42,
          "sourceRow": 12,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -6783.06
        },
        "2026-04-30-corrige": {
          "devis": "D-250017",
          "chantier": "CAP INVEST / LOT 102",
          "montantHT": 16957.65,
          "montantTTC": 18653.42,
          "sourceRow": 12,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -6783.06
        },
        "2026-04-30": {
          "devis": "D-250017",
          "chantier": "CAP INVEST / LOT 102",
          "montantHT": 16957.65,
          "montantTTC": 18653.42,
          "sourceRow": 12,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -6783.06
        },
        "2026-03-31": {
          "devis": "D-250017",
          "chantier": "CAP INVEST / LOT 102",
          "montantHT": 16957.65,
          "montantTTC": 18653.42,
          "sourceRow": 12,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -6783.06
        },
        "2026-02-28": {
          "devis": "D-250017",
          "chantier": "CAP INVEST / LOT 102",
          "montantHT": 16957.65,
          "montantTTC": 18653.42,
          "sourceRow": 12,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.49,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.34,
          "caProvisionner": -5765.601
        },
        "2025-12-31": {
          "devis": "D-250017",
          "chantier": "LOT 102",
          "montantHT": 16957.65,
          "montantTTC": 18653.42,
          "sourceRow": 13,
          "avancementPrecedent": "",
          "avancementReel": 0.15,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.15,
          "caProvisionner": 2543.6475
        }
      }
    },
    {
      "id": "av_010",
      "devis": "D-250016",
      "chantier": "CAP INVEST / LOT 101",
      "values": {
        "2026-05-31": {
          "devis": "D-250016",
          "chantier": "CAP INVEST / LOT 101",
          "montantHT": 20616,
          "montantTTC": 22677.6,
          "sourceRow": 13,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -8246.4
        },
        "2026-04-30-corrige": {
          "devis": "D-250016",
          "chantier": "CAP INVEST / LOT 101",
          "montantHT": 20616,
          "montantTTC": 22677.6,
          "sourceRow": 13,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -8246.4
        },
        "2026-04-30": {
          "devis": "D-250016",
          "chantier": "CAP INVEST / LOT 101",
          "montantHT": 20616,
          "montantTTC": 22677.6,
          "sourceRow": 13,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -8246.4
        },
        "2026-03-31": {
          "devis": "D-250016",
          "chantier": "CAP INVEST / LOT 101",
          "montantHT": 20616,
          "montantTTC": 22677.6,
          "sourceRow": 13,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.4,
          "caProvisionner": -8246.4
        },
        "2026-02-28": {
          "devis": "D-250016",
          "chantier": "CAP INVEST / LOT 101",
          "montantHT": 20616,
          "montantTTC": 22677.6,
          "sourceRow": 13,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.15,
          "pctFacture": 0.49,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.34,
          "caProvisionner": -7009.44
        },
        "2025-12-31": {
          "devis": "D-250016",
          "chantier": "LOT 101",
          "montantHT": 20616,
          "montantTTC": 22677.6,
          "sourceRow": 14,
          "avancementPrecedent": "",
          "avancementReel": 0.15,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.15,
          "caProvisionner": 3092.4
        }
      }
    },
    {
      "id": "av_011",
      "devis": "D-250015",
      "chantier": "CAP INVEST / ELEC CO-LIVING",
      "values": {
        "2026-05-31": {
          "devis": "D-250015",
          "chantier": "CAP INVEST / ELEC CO-LIVING",
          "montantHT": 10380.69,
          "montantTTC": 11418.76,
          "sourceRow": 14,
          "avancementPrecedent": 0.43,
          "avancementReel": 0.43,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.12,
          "caProvisionner": -1245.6828
        },
        "2026-04-30-corrige": {
          "devis": "D-250015",
          "chantier": "CAP INVEST / ELEC CO-LIVING",
          "montantHT": 10380.69,
          "montantTTC": 11418.76,
          "sourceRow": 14,
          "avancementPrecedent": 0.43,
          "avancementReel": 0.43,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.12,
          "caProvisionner": -1245.6828
        },
        "2026-04-30": {
          "devis": "D-250015",
          "chantier": "CAP INVEST / ELEC CO-LIVING",
          "montantHT": 10380.69,
          "montantTTC": 11418.76,
          "sourceRow": 14,
          "avancementPrecedent": 0.43,
          "avancementReel": 0.43,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.12,
          "caProvisionner": -1245.6828
        },
        "2026-03-31": {
          "devis": "D-250015",
          "chantier": "CAP INVEST / ELEC CO-LIVING",
          "montantHT": 10380.69,
          "montantTTC": 11418.76,
          "sourceRow": 14,
          "avancementPrecedent": 0.43,
          "avancementReel": 0.43,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": -0.12,
          "caProvisionner": -1245.6828
        },
        "2026-02-28": {
          "devis": "D-250015",
          "chantier": "CAP INVEST / ELEC CO-LIVING",
          "montantHT": 10380.69,
          "montantTTC": 11418.76,
          "sourceRow": 14,
          "avancementPrecedent": 1,
          "avancementReel": 0.43,
          "pctFacture": 0.49,
          "acompteMois": 0.69,
          "acomptePrecedent": 1,
          "note": "",
          "pctProvisionner": -0.06,
          "caProvisionner": -622.8414
        },
        "2025-12-31": {
          "devis": "D-250015",
          "chantier": "ELEC CO-LIVING",
          "montantHT": 10380.69,
          "montantTTC": 11418.76,
          "sourceRow": 15,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 1,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_012",
      "devis": "D-250031",
      "chantier": "CAP INVEST / CO-LIVING 6éme lot",
      "values": {
        "2026-05-31": {
          "devis": "D-250031",
          "chantier": "CAP INVEST / CO-LIVING 6éme lot",
          "montantHT": 3500.9,
          "montantTTC": 3850.99,
          "sourceRow": 15,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 1575.405
        },
        "2026-04-30-corrige": {
          "devis": "D-250031",
          "chantier": "CAP INVEST / CO-LIVING 6éme lot",
          "montantHT": 3500.9,
          "montantTTC": 3850.99,
          "sourceRow": 15,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 1575.405
        },
        "2026-04-30": {
          "devis": "D-250031",
          "chantier": "CAP INVEST / CO-LIVING 6éme lot",
          "montantHT": 3500.9,
          "montantTTC": 3850.99,
          "sourceRow": 15,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 1575.405
        },
        "2026-03-31": {
          "devis": "D-250031",
          "chantier": "CAP INVEST / CO-LIVING 6éme lot",
          "montantHT": 3500.9,
          "montantTTC": 3850.99,
          "sourceRow": 15,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 1575.405
        },
        "2026-02-28": {
          "devis": "D-250031",
          "chantier": "CAP INVEST / CO-LIVING 6éme lot",
          "montantHT": 3500.9,
          "montantTTC": 3850.99,
          "sourceRow": 15,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.49,
          "acompteMois": 0.69,
          "acomptePrecedent": 1,
          "note": "",
          "pctProvisionner": 0.51,
          "caProvisionner": 1785.459
        },
        "2025-12-31": {
          "devis": "D-250031",
          "chantier": "CO-LIVING 6éme lot",
          "montantHT": 3500.9,
          "montantTTC": 3850.99,
          "sourceRow": 16,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 1,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_013",
      "devis": "D-250050",
      "chantier": "CAP INVEST / Cuisine 6éme lot",
      "values": {
        "2026-05-31": {
          "devis": "D-250050",
          "chantier": "CAP INVEST / Cuisine 6éme lot",
          "montantHT": 1243.85,
          "montantTTC": 1368.24,
          "sourceRow": 16,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 559.7325
        },
        "2026-04-30-corrige": {
          "devis": "D-250050",
          "chantier": "CAP INVEST / Cuisine 6éme lot",
          "montantHT": 1243.85,
          "montantTTC": 1368.24,
          "sourceRow": 16,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 559.7325
        },
        "2026-04-30": {
          "devis": "D-250050",
          "chantier": "CAP INVEST / Cuisine 6éme lot",
          "montantHT": 1243.85,
          "montantTTC": 1368.24,
          "sourceRow": 16,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 559.7325
        },
        "2026-03-31": {
          "devis": "D-250050",
          "chantier": "CAP INVEST / Cuisine 6éme lot",
          "montantHT": 1243.85,
          "montantTTC": 1368.24,
          "sourceRow": 16,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.55,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.69,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 559.7325
        },
        "2026-02-28": {
          "devis": "D-250050",
          "chantier": "CAP INVEST / Cuisine 6éme lot",
          "montantHT": 1243.85,
          "montantTTC": 1368.24,
          "sourceRow": 16,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.49,
          "acompteMois": 0.69,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0.51,
          "caProvisionner": 634.3635
        },
        "2025-12-31": {
          "devis": "D-250050",
          "chantier": "Cuisine 6éme lot",
          "montantHT": 1243.85,
          "montantTTC": 1368.24,
          "sourceRow": 17,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 0,
          "acompteMois": 0,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 1,
          "caProvisionner": 1243.85
        }
      }
    },
    {
      "id": "av_014",
      "devis": "D-250048",
      "chantier": "ERCEAU LOU",
      "values": {
        "2026-05-31": {
          "devis": "D-250048",
          "chantier": "ERCEAU LOU",
          "montantHT": 61200.86,
          "montantTTC": 67320.95,
          "sourceRow": 18,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30-corrige": {
          "devis": "D-250048",
          "chantier": "ERCEAU LOU",
          "montantHT": 61200.86,
          "montantTTC": 67320.95,
          "sourceRow": 18,
          "avancementPrecedent": 0.99,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "D-250048",
          "chantier": "ERCEAU LOU",
          "montantHT": 61200.86,
          "montantTTC": 67320.95,
          "sourceRow": 18,
          "avancementPrecedent": 0.99,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-03-31": {
          "devis": "D-250048",
          "chantier": "ERCEAU LOU",
          "montantHT": 61200.86,
          "montantTTC": 67320.95,
          "sourceRow": 18,
          "avancementPrecedent": 0.68,
          "avancementReel": 0.99,
          "pctFacture": 0.8,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.19,
          "caProvisionner": 11628.1634
        },
        "2026-02-28": {
          "devis": "D-250048",
          "chantier": "ERCEAU LOU",
          "montantHT": 61200.86,
          "montantTTC": 67320.95,
          "sourceRow": 18,
          "avancementPrecedent": 0.4,
          "avancementReel": 0.68,
          "pctFacture": 0.78,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": -0.1,
          "caProvisionner": -6120.086
        },
        "2025-12-31": {
          "devis": "D-250048",
          "chantier": "ERCEAU LOU",
          "montantHT": 72604.67,
          "montantTTC": 79865.14,
          "sourceRow": 19,
          "avancementPrecedent": "",
          "avancementReel": 0.4,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.4,
          "caProvisionner": 29041.868
        }
      }
    },
    {
      "id": "av_015",
      "devis": "",
      "chantier": "ERCEAU LOU",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "ERCEAU LOU",
          "montantHT": 1799.6,
          "montantTTC": 1979.56,
          "sourceRow": 19,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "ERCEAU LOU",
          "montantHT": 1799.6,
          "montantTTC": 1979.56,
          "sourceRow": 19,
          "avancementPrecedent": 0,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "ERCEAU LOU",
          "montantHT": 1799.6,
          "montantTTC": 1979.56,
          "sourceRow": 19,
          "avancementPrecedent": 0,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-03-31": {
          "devis": "",
          "chantier": "ERCEAU LOU",
          "montantHT": 1799.6,
          "montantTTC": 1979.56,
          "sourceRow": 19,
          "avancementPrecedent": 0,
          "avancementReel": 0,
          "pctFacture": 0.8,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.8,
          "caProvisionner": 1439.68
        },
        "2026-02-28": {
          "devis": "",
          "chantier": "ERCEAU LOU",
          "montantHT": 1799.6,
          "montantTTC": 1979.56,
          "sourceRow": 19,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0.78,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.78,
          "caProvisionner": 1403.688
        }
      }
    },
    {
      "id": "av_016",
      "devis": "D-250005",
      "chantier": "METOIS EXTENSION",
      "values": {
        "2026-05-31": {
          "devis": "D-250005",
          "chantier": "METOIS EXTENSION",
          "montantHT": 72122.86,
          "montantTTC": 84410.92,
          "sourceRow": 21,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.95,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.18,
          "caProvisionner": 12982.1148
        },
        "2026-04-30-corrige": {
          "devis": "D-250005",
          "chantier": "METOIS EXTENSION",
          "montantHT": 72122.86,
          "montantTTC": 84410.92,
          "sourceRow": 21,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 9375.9718
        },
        "2026-04-30": {
          "devis": "D-250005",
          "chantier": "METOIS EXTENSION",
          "montantHT": 72122.86,
          "montantTTC": 84410.92,
          "sourceRow": 21,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 9375.9718
        },
        "2026-03-31": {
          "devis": "D-250005",
          "chantier": "METOIS EXTENSION",
          "montantHT": 72122.86,
          "montantTTC": 84410.92,
          "sourceRow": 21,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.7,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": -0.07,
          "caProvisionner": -5048.6002
        },
        "2026-02-28": {
          "devis": "D-250005",
          "chantier": "METOIS EXTENSION",
          "montantHT": 72122.86,
          "montantTTC": 84410.92,
          "sourceRow": 22,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.7,
          "pctFacture": 0.68,
          "acompteMois": 0.63,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.02,
          "caProvisionner": 1442.4572
        },
        "2025-12-31": {
          "devis": "D-250005",
          "chantier": "METOIS EXTENSION",
          "montantHT": 72122.86,
          "montantTTC": 84410.92,
          "sourceRow": 21,
          "avancementPrecedent": "",
          "avancementReel": 0.9,
          "pctFacture": 0.8,
          "acompteMois": "",
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.1,
          "caProvisionner": 7212.286
        }
      }
    },
    {
      "id": "av_017",
      "devis": "D-250019",
      "chantier": "MURS + DALLE",
      "values": {
        "2026-05-31": {
          "devis": "D-250019",
          "chantier": "MURS + DALLE",
          "montantHT": 6861.85,
          "montantTTC": 7548.04,
          "sourceRow": 22,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.95,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.18,
          "caProvisionner": 1235.133
        },
        "2026-04-30-corrige": {
          "devis": "D-250019",
          "chantier": "MURS + DALLE",
          "montantHT": 6861.85,
          "montantTTC": 7548.04,
          "sourceRow": 22,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 892.0405
        },
        "2026-04-30": {
          "devis": "D-250019",
          "chantier": "MURS + DALLE",
          "montantHT": 6861.85,
          "montantTTC": 7548.04,
          "sourceRow": 22,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 892.0405
        },
        "2026-03-31": {
          "devis": "D-250019",
          "chantier": "MURS + DALLE",
          "montantHT": 6861.85,
          "montantTTC": 7548.04,
          "sourceRow": 22,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.7,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": -0.07,
          "caProvisionner": -480.3295
        },
        "2026-02-28": {
          "devis": "D-250019",
          "chantier": "MURS + DALLE",
          "montantHT": 6861.85,
          "montantTTC": 7548.04,
          "sourceRow": 23,
          "avancementPrecedent": 0.5,
          "avancementReel": 0.7,
          "pctFacture": 0.68,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0.02,
          "caProvisionner": 137.237
        },
        "2025-12-31": {
          "devis": "D-250019",
          "chantier": "MURS + DALLE",
          "montantHT": 6861.85,
          "montantTTC": 7548.04,
          "sourceRow": 22,
          "avancementPrecedent": "",
          "avancementReel": 0.5,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.5,
          "caProvisionner": 3430.925
        }
      }
    },
    {
      "id": "av_018",
      "devis": "D-250032",
      "chantier": "AVENANT ISOLANT",
      "values": {
        "2026-05-31": {
          "devis": "D-250032",
          "chantier": "AVENANT ISOLANT",
          "montantHT": 3162.1,
          "montantTTC": 3478.31,
          "sourceRow": 23,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.95,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.18,
          "caProvisionner": 569.178
        },
        "2026-04-30-corrige": {
          "devis": "D-250032",
          "chantier": "AVENANT ISOLANT",
          "montantHT": 3162.1,
          "montantTTC": 3478.31,
          "sourceRow": 23,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 411.073
        },
        "2026-04-30": {
          "devis": "D-250032",
          "chantier": "AVENANT ISOLANT",
          "montantHT": 3162.1,
          "montantTTC": 3478.31,
          "sourceRow": 23,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 411.073
        },
        "2026-03-31": {
          "devis": "D-250032",
          "chantier": "AVENANT ISOLANT",
          "montantHT": 3162.1,
          "montantTTC": 3478.31,
          "sourceRow": 23,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.7,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": -0.07,
          "caProvisionner": -221.347
        },
        "2026-02-28": {
          "devis": "D-250032",
          "chantier": "AVENANT ISOLANT",
          "montantHT": 3162.1,
          "montantTTC": 3478.31,
          "sourceRow": 24,
          "avancementPrecedent": 1,
          "avancementReel": 0.7,
          "pctFacture": 0.68,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0.02,
          "caProvisionner": 63.242
        },
        "2025-12-31": {
          "devis": "D-250032",
          "chantier": "AVENANT ISOLANT",
          "montantHT": 3162.1,
          "montantTTC": 3478.31,
          "sourceRow": 23,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 1,
          "caProvisionner": 3162.1
        }
      }
    },
    {
      "id": "av_019",
      "devis": "D-250049",
      "chantier": "AVENANT COUVERTURE",
      "values": {
        "2026-05-31": {
          "devis": "D-250049",
          "chantier": "AVENANT COUVERTURE",
          "montantHT": 5263.5,
          "montantTTC": 6316.2,
          "sourceRow": 24,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.95,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.18,
          "caProvisionner": 947.43
        },
        "2026-04-30-corrige": {
          "devis": "D-250049",
          "chantier": "AVENANT COUVERTURE",
          "montantHT": 5263.5,
          "montantTTC": 6316.2,
          "sourceRow": 24,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 684.255
        },
        "2026-04-30": {
          "devis": "D-250049",
          "chantier": "AVENANT COUVERTURE",
          "montantHT": 5263.5,
          "montantTTC": 6316.2,
          "sourceRow": 24,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.9,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 684.255
        },
        "2026-03-31": {
          "devis": "D-250049",
          "chantier": "AVENANT COUVERTURE",
          "montantHT": 5263.5,
          "montantTTC": 6316.2,
          "sourceRow": 24,
          "avancementPrecedent": 0.7,
          "avancementReel": 0.7,
          "pctFacture": 0.77,
          "acompteMois": 0.63,
          "acomptePrecedent": 0.63,
          "note": "",
          "pctProvisionner": -0.07,
          "caProvisionner": -368.445
        },
        "2026-02-28": {
          "devis": "D-250049",
          "chantier": "AVENANT COUVERTURE",
          "montantHT": 5263.5,
          "montantTTC": 6316.2,
          "sourceRow": 25,
          "avancementPrecedent": 1,
          "avancementReel": 0.7,
          "pctFacture": 0.68,
          "acompteMois": 0.63,
          "acomptePrecedent": 1,
          "note": "",
          "pctProvisionner": 0.02,
          "caProvisionner": 105.27
        },
        "2025-12-31": {
          "devis": "D-250049",
          "chantier": "AVENANT COUVERTURE",
          "montantHT": 5263.5,
          "montantTTC": 6316.2,
          "sourceRow": 24,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 1,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_020",
      "devis": "D-240062",
      "chantier": "GILDAS",
      "values": {
        "2026-05-31": {
          "devis": "D-240062",
          "chantier": "GILDAS",
          "montantHT": 63789.21,
          "montantTTC": 70168.13,
          "sourceRow": 26,
          "avancementPrecedent": 0.93,
          "avancementReel": 0.99,
          "pctFacture": 1,
          "acompteMois": 0.55,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": -0.01,
          "caProvisionner": -637.8921
        },
        "2026-04-30-corrige": {
          "devis": "D-240062",
          "chantier": "GILDAS",
          "montantHT": 63789.21,
          "montantTTC": 70168.13,
          "sourceRow": 26,
          "avancementPrecedent": 0.79,
          "avancementReel": 0.93,
          "pctFacture": 1,
          "acompteMois": 0.55,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": -0.07,
          "caProvisionner": -4465.2447
        },
        "2026-04-30": {
          "devis": "D-240062",
          "chantier": "GILDAS",
          "montantHT": 63789.21,
          "montantTTC": 70168.13,
          "sourceRow": 26,
          "avancementPrecedent": 0.79,
          "avancementReel": 0.93,
          "pctFacture": 1,
          "acompteMois": 0.55,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": -0.07,
          "caProvisionner": -4465.2447
        },
        "2026-03-31": {
          "devis": "D-240062",
          "chantier": "GILDAS",
          "montantHT": 63789.21,
          "montantTTC": "",
          "sourceRow": 26,
          "avancementPrecedent": 0.52,
          "avancementReel": 0.79,
          "pctFacture": 1,
          "acompteMois": 0.55,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": -0.21,
          "caProvisionner": -13395.7341
        },
        "2026-02-28": {
          "devis": "D-240062",
          "chantier": "GILDAS",
          "montantHT": 53763.37,
          "montantTTC": 59139.71,
          "sourceRow": 27,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.52,
          "pctFacture": 0.9,
          "acompteMois": 0.55,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": -0.38,
          "caProvisionner": -20430.0806
        },
        "2025-12-31": {
          "devis": "D-240062",
          "chantier": "GILDAS",
          "montantHT": 53763.37,
          "montantTTC": 59139.71,
          "sourceRow": 26,
          "avancementPrecedent": "",
          "avancementReel": 0.9,
          "pctFacture": 0.8,
          "acompteMois": "",
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.1,
          "caProvisionner": 5376.337
        }
      }
    },
    {
      "id": "av_021",
      "devis": "",
      "chantier": "GILDAS PEINTURE",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "GILDAS PEINTURE",
          "montantHT": 5702.85,
          "montantTTC": 6273.14,
          "sourceRow": 27,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.9,
          "acompteMois": 0.51,
          "acomptePrecedent": 0.51,
          "note": "",
          "pctProvisionner": 0.1,
          "caProvisionner": 570.285
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "GILDAS PEINTURE",
          "montantHT": 5702.85,
          "montantTTC": 6273.14,
          "sourceRow": 27,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 0.9,
          "acompteMois": 0.51,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": 0.1,
          "caProvisionner": 570.285
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "GILDAS PEINTURE",
          "montantHT": 5702.85,
          "montantTTC": 6273.14,
          "sourceRow": 27,
          "avancementPrecedent": 1,
          "avancementReel": 0.9,
          "pctFacture": 0.9,
          "acompteMois": 0.51,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-03-31": {
          "devis": "",
          "chantier": "GILDAS PEINTURE",
          "montantHT": 5702.85,
          "montantTTC": 6273.14,
          "sourceRow": 27,
          "avancementPrecedent": 0,
          "avancementReel": 1,
          "pctFacture": 0.9,
          "acompteMois": 0.51,
          "acomptePrecedent": 0.55,
          "note": "",
          "pctProvisionner": 0.1,
          "caProvisionner": 570.285
        },
        "2026-02-28": {
          "devis": "",
          "chantier": "GILDAS PEINTURE",
          "montantHT": 5702.85,
          "montantTTC": 6273.14,
          "sourceRow": 28,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0.9,
          "acompteMois": 0.55,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": -0.9,
          "caProvisionner": -5132.565
        }
      }
    },
    {
      "id": "av_022",
      "devis": "D-250012",
      "chantier": "DOUAULT",
      "values": {
        "2026-05-31": {
          "devis": "D-250012",
          "chantier": "DOUAULT",
          "montantHT": 11356.56,
          "montantTTC": 12492.22,
          "sourceRow": 29,
          "avancementPrecedent": 0.99,
          "avancementReel": "",
          "pctFacture": 0.82,
          "acompteMois": 0,
          "acomptePrecedent": 0,
          "note": "",
          "pctProvisionner": -0.82,
          "caProvisionner": -9312.3792
        },
        "2026-04-30-corrige": {
          "devis": "D-250012",
          "chantier": "DOUAULT",
          "montantHT": 11356.56,
          "montantTTC": 12492.22,
          "sourceRow": 29,
          "avancementPrecedent": 0.99,
          "avancementReel": 0.99,
          "pctFacture": 0.82,
          "acompteMois": 0,
          "acomptePrecedent": 0,
          "note": "",
          "pctProvisionner": 0.17,
          "caProvisionner": 1930.6152
        },
        "2026-04-30": {
          "devis": "D-250012",
          "chantier": "DOUAULT",
          "montantHT": 11356.56,
          "montantTTC": 12492.22,
          "sourceRow": 29,
          "avancementPrecedent": 0.99,
          "avancementReel": 0.99,
          "pctFacture": 0.82,
          "acompteMois": 0,
          "acomptePrecedent": 0,
          "note": "",
          "pctProvisionner": 0.17,
          "caProvisionner": 1930.6152
        },
        "2026-03-31": {
          "devis": "D-250012",
          "chantier": "DOUAULT",
          "montantHT": 11356.56,
          "montantTTC": 12492.22,
          "sourceRow": 29,
          "avancementPrecedent": 0.82,
          "avancementReel": 0.99,
          "pctFacture": 0.82,
          "acompteMois": 0,
          "acomptePrecedent": 0,
          "note": "",
          "pctProvisionner": 0.17,
          "caProvisionner": 1930.6152
        },
        "2026-02-28": {
          "devis": "D-250012",
          "chantier": "DOUAULT",
          "montantHT": 11356.56,
          "montantTTC": 12492.22,
          "sourceRow": 31,
          "avancementPrecedent": 0.8231,
          "avancementReel": 0.82,
          "pctFacture": 0.82,
          "acompteMois": 0,
          "acomptePrecedent": "",
          "note": "Francois ne sait pas",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2025-12-31": {
          "devis": "D-250012",
          "chantier": "DOUAULT",
          "montantHT": 11356.56,
          "montantTTC": 12492.22,
          "sourceRow": 28,
          "avancementPrecedent": "",
          "avancementReel": 0.8231,
          "pctFacture": 0.8231,
          "acompteMois": "",
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_023",
      "devis": "ARTHUR",
      "chantier": "FOURMOND - Bureau",
      "values": {
        "2026-05-31": {
          "devis": "ARTHUR",
          "chantier": "FOURMOND - Bureau",
          "montantHT": 10294.52,
          "montantTTC": 11323.97,
          "sourceRow": 31,
          "avancementPrecedent": 0.47,
          "avancementReel": 0.75,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.75,
          "caProvisionner": 7720.89
        }
      }
    },
    {
      "id": "av_024",
      "devis": "",
      "chantier": "FOURMOND - R+1",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "FOURMOND - R+1",
          "montantHT": 23172.72,
          "montantTTC": 25489.99,
          "sourceRow": 32,
          "avancementPrecedent": 0.33,
          "avancementReel": 0.45,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.45,
          "caProvisionner": 10427.724
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "FOURMOND - R+1",
          "montantHT": 23172.72,
          "montantTTC": 25489.99,
          "sourceRow": 32,
          "avancementPrecedent": 0.27,
          "avancementReel": 0.33,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.33,
          "caProvisionner": 7646.9976
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "FOURMOND - R+1",
          "montantHT": 23172.72,
          "montantTTC": 25489.99,
          "sourceRow": 32,
          "avancementPrecedent": 0.27,
          "avancementReel": 0.33,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.33,
          "caProvisionner": 7646.9976
        },
        "2026-03-31": {
          "devis": "",
          "chantier": "FOURMOND - R+1",
          "montantHT": 23172.72,
          "montantTTC": 25489.99,
          "sourceRow": 32,
          "avancementPrecedent": 0.25,
          "avancementReel": 0.27,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.27,
          "caProvisionner": 6256.6344
        },
        "2026-02-28": {
          "devis": "",
          "chantier": "FOURMOND - R+1",
          "montantHT": 23172.72,
          "montantTTC": 25489.99,
          "sourceRow": 34,
          "avancementPrecedent": "",
          "avancementReel": 0.25,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.25,
          "caProvisionner": 5793.18
        }
      }
    },
    {
      "id": "av_025",
      "devis": "",
      "chantier": "FOURMOND - R+2",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "FOURMOND - R+2",
          "montantHT": 30328.72,
          "montantTTC": 28992.47,
          "sourceRow": 33,
          "avancementPrecedent": 0.49,
          "avancementReel": 0.7,
          "pctFacture": 0,
          "acompteMois": 0.67,
          "acomptePrecedent": 0.67,
          "note": "",
          "pctProvisionner": 0.7,
          "caProvisionner": 21230.104
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "FOURMOND - R+2",
          "montantHT": 30328.72,
          "montantTTC": 28992.47,
          "sourceRow": 33,
          "avancementPrecedent": 0.3,
          "avancementReel": 0.49,
          "pctFacture": 0,
          "acompteMois": 0.67,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.49,
          "caProvisionner": 14861.0728
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "FOURMOND - R+2",
          "montantHT": 30328.72,
          "montantTTC": 28992.47,
          "sourceRow": 33,
          "avancementPrecedent": 0.3,
          "avancementReel": 0.49,
          "pctFacture": 0,
          "acompteMois": 0.67,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.49,
          "caProvisionner": 14861.0728
        }
      }
    },
    {
      "id": "av_026",
      "devis": "",
      "chantier": "PHILIBERT / JEAN MARIE ANGERS",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "PHILIBERT / JEAN MARIE ANGERS",
          "montantHT": 19637.29,
          "montantTTC": 19334.54,
          "sourceRow": 35,
          "avancementPrecedent": 1,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "PHILIBERT / JEAN MARIE ANGERS",
          "montantHT": 19637.29,
          "montantTTC": 19334.54,
          "sourceRow": 35,
          "avancementPrecedent": 0.99,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "PHILIBERT / JEAN MARIE ANGERS",
          "montantHT": 19637.29,
          "montantTTC": 19334.54,
          "sourceRow": 35,
          "avancementPrecedent": 0.99,
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-03-31": {
          "devis": "",
          "chantier": "PHILIBERT / JEAN MARIE ANGERS",
          "montantHT": 19637.29,
          "montantTTC": 19334.54,
          "sourceRow": 35,
          "avancementPrecedent": 0.9,
          "avancementReel": 0.99,
          "pctFacture": 0.98,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0.01,
          "caProvisionner": 196.3729
        }
      }
    },
    {
      "id": "av_027",
      "devis": "",
      "chantier": "MAUDUIT",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "MAUDUIT",
          "montantHT": 25850.19,
          "montantTTC": 28435.21,
          "sourceRow": 37,
          "avancementPrecedent": 0,
          "avancementReel": 0.25,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0.25,
          "caProvisionner": 6462.5475
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "MAUDUIT",
          "montantHT": 25850.19,
          "montantTTC": 28435.21,
          "sourceRow": 37,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "MAUDUIT",
          "montantHT": 25850.19,
          "montantTTC": 28435.21,
          "sourceRow": 37,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_028",
      "devis": "TOM & CAMILLE",
      "chantier": "TROTTIER T3 - RDC",
      "values": {
        "2026-05-31": {
          "devis": "TOM & CAMILLE",
          "chantier": "TROTTIER T3 - RDC",
          "montantHT": 22593.87,
          "montantTTC": 24853.26,
          "sourceRow": 39,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.28,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.28,
          "caProvisionner": 6326.2836
        }
      }
    },
    {
      "id": "av_029",
      "devis": "",
      "chantier": "TROTTIER T3 - R+1",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "TROTTIER T3 - R+1",
          "montantHT": 21044.11,
          "montantTTC": 23148.52,
          "sourceRow": 40,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.25,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.25,
          "caProvisionner": 5261.0275
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "TROTTIER T3 - R+1",
          "montantHT": 21044.11,
          "montantTTC": 23148.52,
          "sourceRow": 40,
          "avancementPrecedent": "",
          "avancementReel": 0.15,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.15,
          "caProvisionner": 3156.6165
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "TROTTIER T3 - R+1",
          "montantHT": 21044.11,
          "montantTTC": 23148.52,
          "sourceRow": 40,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_030",
      "devis": "",
      "chantier": "TROTTIER T3 - R+2",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "TROTTIER T3 - R+2",
          "montantHT": 28434.74,
          "montantTTC": 31278.21,
          "sourceRow": 41,
          "avancementPrecedent": 0.15,
          "avancementReel": 0.43,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.43,
          "caProvisionner": 12226.9382
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "TROTTIER T3 - R+2",
          "montantHT": 28434.74,
          "montantTTC": 31278.21,
          "sourceRow": 41,
          "avancementPrecedent": "",
          "avancementReel": 0.15,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.15,
          "caProvisionner": 4265.211
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "TROTTIER T3 - R+2",
          "montantHT": 28434.74,
          "montantTTC": 31278.21,
          "sourceRow": 41,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_031",
      "devis": "BD ROI RENE",
      "chantier": "MONTAIGNE - ABRI VELO",
      "values": {
        "2026-05-31": {
          "devis": "BD ROI RENE",
          "chantier": "MONTAIGNE - ABRI VELO",
          "montantHT": 1319.73,
          "montantTTC": 1451.7,
          "sourceRow": 43,
          "avancementPrecedent": 0,
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_032",
      "devis": "",
      "chantier": "MONTAIGNE - CAGE ESCALIER",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "MONTAIGNE - CAGE ESCALIER",
          "montantHT": 9567.76,
          "montantTTC": 10524.54,
          "sourceRow": 44,
          "avancementPrecedent": 0,
          "avancementReel": 1,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 1,
          "caProvisionner": 9567.76
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "MONTAIGNE - CAGE ESCALIER",
          "montantHT": 9567.76,
          "montantTTC": 10524.54,
          "sourceRow": 44,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "MONTAIGNE - CAGE ESCALIER",
          "montantHT": 9567.76,
          "montantTTC": 10524.54,
          "sourceRow": 44,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_033",
      "devis": "",
      "chantier": "MONTAIGNE - LINKY",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "MONTAIGNE - LINKY",
          "montantHT": 1404.24,
          "montantTTC": 1544.66,
          "sourceRow": 45,
          "avancementPrecedent": 0,
          "avancementReel": 1,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 1,
          "caProvisionner": 1404.24
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "MONTAIGNE - LINKY",
          "montantHT": 1404.24,
          "montantTTC": 1544.66,
          "sourceRow": 45,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "MONTAIGNE - LINKY",
          "montantHT": 1404.24,
          "montantTTC": 1544.66,
          "sourceRow": 45,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_034",
      "devis": "",
      "chantier": "MONTAIGNE - RACCORDEMENT EAU",
      "values": {
        "2026-05-31": {
          "devis": "",
          "chantier": "MONTAIGNE - RACCORDEMENT EAU",
          "montantHT": 1056.8,
          "montantTTC": 1162.48,
          "sourceRow": 46,
          "avancementPrecedent": 0,
          "avancementReel": 1,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 1,
          "caProvisionner": 1056.8
        },
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "MONTAIGNE - RACCORDEMENT EAU",
          "montantHT": 1056.8,
          "montantTTC": 1162.48,
          "sourceRow": 46,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "MONTAIGNE - RACCORDEMENT EAU",
          "montantHT": 1056.8,
          "montantTTC": 1162.48,
          "sourceRow": 46,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_035",
      "devis": "",
      "chantier": "FOURMOND - Bureau",
      "values": {
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "FOURMOND - Bureau",
          "montantHT": 10294.52,
          "montantTTC": 11323.97,
          "sourceRow": 31,
          "avancementPrecedent": 0.31,
          "avancementReel": 0.47,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.47,
          "caProvisionner": 4838.4244
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "FOURMOND - Bureau",
          "montantHT": 10294.52,
          "montantTTC": 11323.97,
          "sourceRow": 31,
          "avancementPrecedent": 0.31,
          "avancementReel": 0.47,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.47,
          "caProvisionner": 4838.4244
        },
        "2026-03-31": {
          "devis": "",
          "chantier": "FOURMOND - Bureau",
          "montantHT": 10294.52,
          "montantTTC": 11323.97,
          "sourceRow": 31,
          "avancementPrecedent": 0.29,
          "avancementReel": 0.31,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.31,
          "caProvisionner": 3191.3012
        },
        "2026-02-28": {
          "devis": "",
          "chantier": "FOURMOND - Bureau",
          "montantHT": 10294.52,
          "montantTTC": 11323.97,
          "sourceRow": 33,
          "avancementPrecedent": "",
          "avancementReel": 0.29,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.29,
          "caProvisionner": 2985.4108
        }
      }
    },
    {
      "id": "av_036",
      "devis": "",
      "chantier": "TROTTIER T3 - RDC",
      "values": {
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "TROTTIER T3 - RDC",
          "montantHT": 22593.87,
          "montantTTC": 24853.26,
          "sourceRow": 39,
          "avancementPrecedent": "",
          "avancementReel": 0.15,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.15,
          "caProvisionner": 3389.0805
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "TROTTIER T3 - RDC",
          "montantHT": 22593.87,
          "montantTTC": 24853.26,
          "sourceRow": 39,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_037",
      "devis": "",
      "chantier": "MONTAIGNE - ABRI VELO",
      "values": {
        "2026-04-30-corrige": {
          "devis": "",
          "chantier": "MONTAIGNE - ABRI VELO",
          "montantHT": 1319.73,
          "montantTTC": 1451.7,
          "sourceRow": 43,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        },
        "2026-04-30": {
          "devis": "",
          "chantier": "MONTAIGNE - ABRI VELO",
          "montantHT": 1319.73,
          "montantTTC": 1451.7,
          "sourceRow": 43,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_038",
      "devis": "",
      "chantier": "FOURMOND - R+2",
      "values": {
        "2026-03-31": {
          "devis": "",
          "chantier": "FOURMOND - R+2",
          "montantHT": 26356.79,
          "montantTTC": 28992.47,
          "sourceRow": 33,
          "avancementPrecedent": 0.13,
          "avancementReel": 0.3,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "",
          "pctProvisionner": 0.3,
          "caProvisionner": 7907.037
        },
        "2026-02-28": {
          "devis": "",
          "chantier": "FOURMOND - R+2",
          "montantHT": 26356.79,
          "montantTTC": 28992.47,
          "sourceRow": 35,
          "avancementPrecedent": "",
          "avancementReel": 0.13,
          "pctFacture": 0,
          "acompteMois": 0.7,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.13,
          "caProvisionner": 3426.3827
        }
      }
    },
    {
      "id": "av_039",
      "devis": "",
      "chantier": "FUMOLAND",
      "values": {
        "2026-03-31": {
          "devis": "",
          "chantier": "FUMOLAND",
          "montantHT": 65275.11,
          "montantTTC": "",
          "sourceRow": 37,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 1,
          "acompteMois": 0.5,
          "acomptePrecedent": 0.5,
          "note": "",
          "pctProvisionner": 0,
          "caProvisionner": 0
        }
      }
    },
    {
      "id": "av_040",
      "devis": "",
      "chantier": "ERCEAU LOU",
      "values": {
        "2026-02-28": {
          "devis": "",
          "chantier": "ERCEAU LOU",
          "montantHT": 11403.81,
          "montantTTC": "",
          "sourceRow": 20,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0.78,
          "acompteMois": 0.7,
          "acomptePrecedent": 0.7,
          "note": "Marché selon ProGbat = 74404.27",
          "pctProvisionner": -0.78,
          "caProvisionner": -8894.9718
        }
      }
    },
    {
      "id": "av_041",
      "devis": "",
      "chantier": "GILDAS",
      "values": {
        "2026-02-28": {
          "devis": "",
          "chantier": "GILDAS",
          "montantHT": 4322.99,
          "montantTTC": "",
          "sourceRow": 29,
          "avancementPrecedent": "",
          "avancementReel": 0,
          "pctFacture": 0.9,
          "acompteMois": 0.55,
          "acomptePrecedent": "",
          "note": "Marché selon ProGbat = 63789.21",
          "pctProvisionner": -0.9,
          "caProvisionner": -3890.691
        }
      }
    },
    {
      "id": "av_042",
      "devis": "",
      "chantier": "PHILIBERT",
      "values": {
        "2026-02-28": {
          "devis": "",
          "chantier": "PHILIBERT",
          "montantHT": 17576.85,
          "montantTTC": 19334.54,
          "sourceRow": 37,
          "avancementPrecedent": "",
          "avancementReel": 0.9,
          "pctFacture": 0.95,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": -0.05,
          "caProvisionner": -878.8425
        }
      }
    },
    {
      "id": "av_043",
      "devis": "",
      "chantier": "PHILIBERT",
      "values": {
        "2026-02-28": {
          "devis": "",
          "chantier": "PHILIBERT",
          "montantHT": 1608.72,
          "montantTTC": 1769.59,
          "sourceRow": 38,
          "avancementPrecedent": "",
          "avancementReel": 1,
          "pctFacture": 0.95,
          "acompteMois": 0.5,
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": 0.05,
          "caProvisionner": 80.436
        }
      }
    },
    {
      "id": "av_044",
      "devis": "",
      "chantier": "SURPLUS",
      "values": {
        "2025-12-31": {
          "devis": "",
          "chantier": "SURPLUS",
          "montantHT": "",
          "montantTTC": "",
          "sourceRow": 10,
          "avancementPrecedent": "",
          "avancementReel": "",
          "pctFacture": "",
          "acompteMois": "",
          "acomptePrecedent": "",
          "note": "",
          "pctProvisionner": "",
          "caProvisionner": 0
        }
      }
    }
  ]
};

const DEFAULT_AVANCEMENT_PERIODS = DEFAULT_AVANCEMENT.periods;

const AVANCEMENT_ROW_COLOR_PALETTE = [
  { value: "#FEF3C7", label: "Jaune pâle" },
  { value: "#FFE4B5", label: "Abricot" },
  { value: "#FED7AA", label: "Orange doux" },
  { value: "#FECACA", label: "Rouge pâle" },
  { value: "#FBCFE8", label: "Rose" },
  { value: "#E9D5FF", label: "Violet pâle" },
  { value: "#DDD6FE", label: "Lavande" },
  { value: "#C7D2FE", label: "Indigo pâle" },
  { value: "#BFDBFE", label: "Bleu clair" },
  { value: "#BAE6FD", label: "Bleu ciel" },
  { value: "#A5F3FC", label: "Cyan" },
  { value: "#CCFBF1", label: "Turquoise" },
  { value: "#BBF7D0", label: "Vert clair" },
  { value: "#D9F99D", label: "Vert anis" },
  { value: "#ECFCCB", label: "Citron vert" },
  { value: "#FDE68A", label: "Or doux" },
  { value: "#E5E7EB", label: "Gris clair" },
  { value: "#D1D5DB", label: "Gris moyen" },
  { value: "#FAE8FF", label: "Magenta pâle" },
  { value: "#E0F2FE", label: "Bleu glacier" },
];

const ACHAT_TYPOLOGIES = [
  { value: "materiaux", label: "Matériaux" },
  { value: "sous_traitance", label: "Sous-traitance" },
  { value: "outillage", label: "Outillage" },
  { value: "location_materiel", label: "Location matériel" },
  { value: "carburant_deplacement", label: "Carburant / déplacement" },
  { value: "fournitures_chantier", label: "Fournitures chantier" },
  { value: "frais_generaux", label: "Frais généraux" },
  { value: "assurance_banque", label: "Assurance / banque" },
  { value: "honoraires", label: "Honoraires" },
  { value: "autre", label: "Autre" },
];

const ACHAT_CONTROLES = [
  { value: "a_controler", label: "À contrôler" },
  { value: "conforme", label: "Conforme" },
  { value: "ecart", label: "Écart détecté" },
  { value: "doublon_possible", label: "Doublon possible" },
];

const ACHAT_REGLEMENTS = [
  { value: "a_regler", label: "À régler" },
  { value: "regle", label: "Réglée" },
  { value: "partiel", label: "Partiel" },
  { value: "litige", label: "Litige" },
];

const ACHAT_ACCEPTED_FILES = ".pdf,.png,.jpg,.jpeg,.webp";
const ACHAT_ACCEPTED_EXTENSIONS = ACHAT_ACCEPTED_FILES.split(",").map(ext => ext.trim().toLowerCase());

function isAchatAcceptedFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return ACHAT_ACCEPTED_EXTENSIONS.some(ext => name.endsWith(ext));
}

function getAchatPeriodIdFromDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getAchatPeriodLabelFromDate(date = new Date()) {
  const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function createAchatPeriodFromDate(date = new Date()) {
  return {
    id: getAchatPeriodIdFromDate(date),
    label: getAchatPeriodLabelFromDate(date),
  };
}

const DEFAULT_ACHAT_PERIODS = [createAchatPeriodFromDate()];

const DEFAULT_ACHAT = {
  periods: DEFAULT_ACHAT_PERIODS,
  invoicesByPeriod: {
    [DEFAULT_ACHAT_PERIODS[0].id]: [],
  },
};


function createId(prefix = "item") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function emptyMonths() {
  return MOIS.reduce((acc, m) => ({ ...acc, [m.id]: { fg: "", heures: "" } }), {});
}


function createEmptyAchatInvoice(file = null) {
  const draft = file ? extractAchatDraftFromFile(file) : {};

  return {
    id: createId("facture"),
    fileName: file?.name ?? "",
    fileSize: file?.size ?? 0,
    fileType: file?.type ?? "",
    importedAt: new Date().toISOString(),
    fournisseur: draft.fournisseur ?? "",
    typologie: draft.typologie ?? "",
    date: draft.date ?? "",
    numeroFacture: draft.numeroFacture ?? "",
    montantHT: draft.montantHT ?? "0",
    montantTTC: draft.montantTTC ?? "0",
    controle: "a_controler",
    reglement: "a_regler",
    analysisStatus: file ? "importee" : "saisie_manuelle",
    confidence: "",
    note: "",
  };
}

function normalizeAchatInvoice(invoice) {
  return {
    id: invoice?.id || createId("facture"),
    fileName: invoice?.fileName ?? "",
    fileSize: invoice?.fileSize ?? 0,
    fileType: invoice?.fileType ?? "",
    importedAt: invoice?.importedAt ?? "",
    fournisseur: invoice?.fournisseur ?? "",
    typologie: invoice?.typologie ?? "",
    date: invoice?.date ?? "",
    numeroFacture: invoice?.numeroFacture ?? "",
    montantHT: invoice?.montantHT ?? "0",
    montantTTC: invoice?.montantTTC ?? "0",
    controle: invoice?.controle ?? "a_controler",
    reglement: invoice?.reglement ?? "a_regler",
    analysisStatus: invoice?.analysisStatus ?? "importee",
    confidence: invoice?.confidence ?? "",
    note: invoice?.note ?? "",
  };
}

function normalizeAchat(raw) {
  const rawPeriods = Array.isArray(raw?.periods) && raw.periods.length
    ? raw.periods
    : DEFAULT_ACHAT_PERIODS;

  const periods = rawPeriods.map((period, index) => ({
    id: period?.id || (index === 0 ? DEFAULT_ACHAT_PERIODS[0].id : createId("achat_mois")),
    label: period?.label || `Mois ${index + 1}`,
  }));

  const invoicesByPeriod = {};

  if (raw?.invoicesByPeriod && typeof raw.invoicesByPeriod === "object") {
    Object.entries(raw.invoicesByPeriod).forEach(([periodId, invoices]) => {
      invoicesByPeriod[periodId] = Array.isArray(invoices)
        ? invoices.map(normalizeAchatInvoice)
        : [];
    });
  } else if (Array.isArray(raw?.invoices)) {
    // Compatibilité avec l'ancienne version : les factures non classées
    // sont automatiquement placées dans le premier mois disponible.
    invoicesByPeriod[periods[0].id] = raw.invoices.map(normalizeAchatInvoice);
  }

  periods.forEach(period => {
    if (!Array.isArray(invoicesByPeriod[period.id])) {
      invoicesByPeriod[period.id] = [];
    }
  });

  return {
    periods,
    invoicesByPeriod,
  };
}

function extractAchatDraftFromFile(file) {
  const fileName = file?.name || "";
  const cleanName = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const dateMatch = cleanName.match(/(20\d{2})[ .-]?(0[1-9]|1[0-2])[ .-]?([0-2]\d|3[01])/) ||
    cleanName.match(/([0-2]\d|3[01])[ .-]?(0[1-9]|1[0-2])[ .-]?(20\d{2})/);

  let date = "";
  if (dateMatch) {
    if (dateMatch[1]?.startsWith("20")) {
      date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    } else {
      date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    }
  }

  const invoiceMatch = cleanName.match(/(?:facture|fac|invoice|fa|f)[\s-]*([a-z0-9-]{3,})/i);
  const amountMatch = cleanName.match(/(\d+[,.]\d{2})\s*(?:eur|€)?/i);
  const supplier = cleanName
    .replace(/facture|invoice|fac|devis/gi, "")
    .replace(/20\d{2}[ .-]?(0[1-9]|1[0-2])[ .-]?([0-2]\d|3[01])/g, "")
    .replace(/([0-2]\d|3[01])[ .-]?(0[1-9]|1[0-2])[ .-]?(20\d{2})/g, "")
    .replace(/\d+[,.]\d{2}\s*(eur|€)?/gi, "")
    .replace(/[0-9]{3,}/g, "")
    .trim();

  return {
    fournisseur: supplier.slice(0, 60),
    date,
    numeroFacture: invoiceMatch?.[1] ?? "",
    montantTTC: amountMatch ? amountMatch[1].replace(",", ".") : "0",
    typologie: "",
  };
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

function emptyAvancementValue() {
  return {
    devis: "",
    chantier: "",
    montantHT: "",
    montantTTC: "",
    avancementPrecedent: "",
    avancementReel: "",
    pctFacture: "",
    pctProvisionner: "",
    caProvisionner: "",
    acompteMois: "",
    acomptePrecedent: "",
    note: "",
    rowColor: "",
    sourceRow: 9999,
    lockedFields: {},
    inheritedFromPeriodId: "",
  };
}

function createNewAvancementValue() {
  return {
    ...emptyAvancementValue(),
    montantHT: 0,
    montantTTC: 0,
    avancementPrecedent: 0,
    avancementReel: 0,
    pctFacture: 0,
    pctProvisionner: 0,
    caProvisionner: 0,
    acompteMois: 0,
    acomptePrecedent: 0,
    lockedFields: createLockedFields(AVANCEMENT_AUTOMATED_LOCKED_FIELDS),
  };
}

function createAvancementRow(periodId) {
  const row = {
    id: createId("chantier"),
    devis: "",
    chantier: "",
    values: {},
  };

  if (periodId) {
    row.values[periodId] = createNewAvancementValue();
  }

  return row;
}

const AVANCEMENT_INHERITED_LOCKED_FIELDS = [
  "devis",
  "chantier",
  "montantHT",
  "montantTTC",
  "avancementPrecedent",
  "acomptePrecedent",
];

const AVANCEMENT_AUTOMATED_LOCKED_FIELDS = [
  "pctProvisionner",
  "caProvisionner",
];

const AVANCEMENT_INHERITED_DEFAULT_LOCKED_FIELDS = [
  ...AVANCEMENT_INHERITED_LOCKED_FIELDS,
  ...AVANCEMENT_AUTOMATED_LOCKED_FIELDS,
];

function createLockedFields(fields = AVANCEMENT_INHERITED_LOCKED_FIELDS) {
  return fields.reduce((acc, field) => ({ ...acc, [field]: true }), {});
}

function createInheritedAvancementValue(previousValue = {}, previousPeriodId = "") {
  const previousAvancementReel = previousValue?.avancementReel ?? "";
  const previousAcompteMois = previousValue?.acompteMois ?? previousValue?.acomptePrecedent ?? "";

  return {
    ...emptyAvancementValue(),
    devis: previousValue?.devis ?? "",
    chantier: previousValue?.chantier ?? "",
    montantHT: previousValue?.montantHT ?? "",
    montantTTC: previousValue?.montantTTC ?? "",
    // L'avancement précédent du nouveau mois reprend l'avancement réel du mois précédent.
    avancementPrecedent: previousAvancementReel,
    // On initialise l'avancement réel avec la dernière valeur connue, mais il reste modifiable.
    avancementReel: previousAvancementReel,
    pctFacture: previousValue?.pctFacture ?? "",
    acompteMois: previousValue?.acompteMois ?? "",
    acomptePrecedent: previousAcompteMois,
    rowColor: previousValue?.rowColor ?? "",
    note: "",
    sourceRow: previousValue?.sourceRow ?? 9999,
    inheritedFromPeriodId: previousPeriodId,
    lockedFields: createLockedFields(AVANCEMENT_INHERITED_DEFAULT_LOCKED_FIELDS),
  };
}

function isAvancementFieldLocked(values, field) {
  if (AVANCEMENT_AUTOMATED_LOCKED_FIELDS.includes(field)) {
    return values?.lockedFields?.[field] !== false;
  }
  return Boolean(values?.lockedFields?.[field]);
}

function getAvancementClientLabel(row, periodId) {
  const values = row.values?.[periodId] || {};
  return String(values.chantier ?? row.chantier ?? "")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function getOrderedAvancementItems(rows, periodId) {
  if (!periodId) return [];

  return rows
    .filter(row => Boolean(row.values?.[periodId]))
    .map(row => {
      const values = row.values?.[periodId] || {};
      const avancementReel = parsePercent(values.avancementReel);

      return {
        row,
        values,
        isCompleted: avancementReel >= 1,
        sourceRow: parseNumber(values.sourceRow) || 9999,
        clientLabel: getAvancementClientLabel(row, periodId),
      };
    })
    .sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      return a.sourceRow - b.sourceRow;
    });
}

function resequenceAvancementRows(rows, periodId, orderedIds) {
  const sourceRowById = new Map(orderedIds.map((id, index) => [id, index + 1]));

  return rows.map(row => {
    if (!row.values?.[periodId]) return row;

    return {
      ...row,
      values: {
        ...row.values,
        [periodId]: {
          ...row.values[periodId],
          sourceRow: sourceRowById.get(row.id) ?? row.values[periodId].sourceRow ?? 9999,
        },
      },
    };
  });
}

function normalizeAvancement(raw) {
  const source = Array.isArray(raw?.rows) && raw.rows.length > 0
    ? raw
    : DEFAULT_AVANCEMENT;

  const periods = Array.isArray(source?.periods) && source.periods.length > 0
    ? source.periods
    : DEFAULT_AVANCEMENT_PERIODS;

  const rows = Array.isArray(source?.rows)
    ? source.rows.map(row => {
        const rawValues = row.values || {};
        const values = Object.fromEntries(
          Object.entries(rawValues).map(([periodId, value]) => [
            periodId,
            {
              devis: value?.devis ?? row.devis ?? "",
              chantier: value?.chantier ?? row.chantier ?? "",
              montantHT: value?.montantHT ?? row.montantHT ?? "",
              montantTTC: value?.montantTTC ?? row.montantTTC ?? "",
              avancementPrecedent: value?.avancementPrecedent ?? "",
              avancementReel: value?.avancementReel ?? "",
              pctFacture: value?.pctFacture ?? "",
              pctProvisionner: value?.pctProvisionner ?? "",
              caProvisionner: value?.caProvisionner ?? "",
              acompteMois: value?.acompteMois ?? "",
              acomptePrecedent: value?.acomptePrecedent ?? "",
              note: value?.note ?? "",
              rowColor: value?.rowColor ?? "",
              sourceRow: value?.sourceRow ?? 9999,
              lockedFields: {
                ...createLockedFields(AVANCEMENT_AUTOMATED_LOCKED_FIELDS),
                ...(value?.lockedFields ?? {}),
              },
              inheritedFromPeriodId: value?.inheritedFromPeriodId ?? "",
            },
          ])
        );

        return {
          id: row.id || createId("chantier"),
          devis: row.devis ?? "",
          chantier: row.chantier ?? "",
          values,
        };
      })
    : [];

  return {
    periods: periods.map(p => ({
      id: p.id || createId("periode"),
      label: p.label || "Mois d'avancement",
    })),
    rows,
  };
}

const parseNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const cleaned = String(value)
    .replace(/\s/g, "")
    .replace("€", "")
    .replace(",", ".");
  return parseFloat(cleaned) || 0;
};

const parsePercent = (value) => {
  const n = parseNumber(value);
  if (Math.abs(n) > 1) return n / 100;
  return n;
};

const fmtEur = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " €";

const fmtH = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " h";

const fmtTaux = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €/h";

const fmtPct = (n) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n * 100) + " %";

export default function PageEtatsFinanciers({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);

  const [activeTab, setActiveTab] = useState("frais_generaux");
  const [activeAvancementPeriodId, setActiveAvancementPeriodId] = useState(DEFAULT_AVANCEMENT_PERIODS[0].id);
  const [activeAchatPeriodId, setActiveAchatPeriodId] = useState(DEFAULT_ACHAT_PERIODS[0].id);
  const [months, setMonths] = useState(emptyMonths());
  const [avancement, setAvancement] = useState(() => normalizeAvancement());
  const [achat, setAchat] = useState(() => normalizeAchat());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const tabs = [
    { id: "frais_generaux", label: "Frais généraux", icon: Calculator },
    { id: "avancement_chantier", label: "Avancement de chantier", icon: Clock },
    { id: "achat", label: "Achat", icon: Euro },
    { id: "situation", label: "Situation", icon: Euro },
    { id: "analyse_financiere", label: "Analyse financière", icon: TrendingUp },
  ];

  // ── Chargement ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("planning_config")
        .select("value")
        .eq("key", KEY)
        .maybeSingle();

      if (data?.value?.months) {
        setMonths({ ...emptyMonths(), ...data.value.months });
      }

      const nextAvancement = normalizeAvancement(data?.value?.avancement);
      setAvancement(nextAvancement);
      setActiveAvancementPeriodId(nextAvancement.periods[0]?.id || DEFAULT_AVANCEMENT_PERIODS[0].id);

      const nextAchat = normalizeAchat(data?.value?.achat);
      setAchat(nextAchat);
      setActiveAchatPeriodId(nextAchat.periods[0]?.id || DEFAULT_ACHAT_PERIODS[0].id);

      setDirty(false);
    } catch (e) {
      console.error("EtatsFinanciers load:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Sauvegarde manuelle ─────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);

    const { error } = await supabase
      .from("planning_config")
      .upsert(
        {
          key: KEY,
          value: { months, avancement, achat },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    setSaving(false);

    if (error) {
      console.error("EtatsFinanciers save:", error);
      alert("Erreur lors de la sauvegarde : " + error.message);
      return;
    }

    setDirty(false);
    setLastSavedAt(new Date());
  };

  const updateField = (moisId, field, raw) => {
    setMonths(prev => ({
      ...prev,
      [moisId]: {
        ...prev[moisId],
        [field]: raw,
      },
    }));

    setDirty(true);
  };

  const addAvancementRow = () => {
    setAvancement(prev => ({
      ...prev,
      rows: [...prev.rows, createAvancementRow(activeAvancementPeriodId)],
    }));
    setDirty(true);
  };

  const removeAvancementRow = (rowId) => {
    if (!window.confirm("Supprimer ce chantier de l'avancement ?")) return;

    setAvancement(prev => ({
      ...prev,
      rows: prev.rows.filter(row => row.id !== rowId),
    }));
    setDirty(true);
  };

  const reorderAvancementRows = (draggedRowId, targetRowId, periodId) => {
    if (!periodId || !draggedRowId || !targetRowId || draggedRowId === targetRowId) return;

    setAvancement(prev => {
      const orderedItems = getOrderedAvancementItems(prev.rows, periodId);
      const dragged = orderedItems.find(item => item.row.id === draggedRowId);
      const target = orderedItems.find(item => item.row.id === targetRowId);

      if (!dragged || !target) return prev;

      const activeItems = orderedItems.filter(item => !item.isCompleted);
      const completedItems = orderedItems.filter(item => item.isCompleted);
      const draggedGroup = dragged.isCompleted ? completedItems : activeItems;
      const targetGroup = target.isCompleted ? completedItems : activeItems;

      // Les chantiers terminés restent dans le bloc du bas.
      // Le drag & drop réorganise donc les lignes à l'intérieur du même bloc.
      if (dragged.isCompleted !== target.isCompleted) return prev;

      const fromIndex = draggedGroup.findIndex(item => item.row.id === draggedRowId);
      const toIndex = targetGroup.findIndex(item => item.row.id === targetRowId);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;

      const nextGroup = [...draggedGroup];
      const [movedItem] = nextGroup.splice(fromIndex, 1);
      nextGroup.splice(toIndex, 0, movedItem);

      const nextOrderedItems = dragged.isCompleted
        ? [...activeItems, ...nextGroup]
        : [...nextGroup, ...completedItems];
      const nextOrderedIds = nextOrderedItems.map(item => item.row.id);

      return {
        ...prev,
        rows: resequenceAvancementRows(prev.rows, periodId, nextOrderedIds),
      };
    });

    setDirty(true);
  };

  const updateAvancementRow = (rowId, field, raw) => {
    setAvancement(prev => ({
      ...prev,
      rows: prev.rows.map(row => (
        row.id === rowId
          ? { ...row, [field]: raw }
          : row
      )),
    }));
    setDirty(true);
  };

  const updateAvancementValue = (rowId, periodId, field, raw) => {
    setAvancement(prev => ({
      ...prev,
      rows: prev.rows.map(row => (
        row.id === rowId
          ? {
              ...row,
              values: {
                ...row.values,
                [periodId]: {
                  ...(row.values?.[periodId] || {}),
                  [field]: raw,
                },
              },
            }
          : row
      )),
    }));
    setDirty(true);
  };

  const toggleAvancementLock = (rowId, periodId, field) => {
    setAvancement(prev => ({
      ...prev,
      rows: prev.rows.map(row => {
        if (row.id !== rowId) return row;

        const currentValue = row.values?.[periodId] || emptyAvancementValue();
        const currentLocks = currentValue.lockedFields || {};
        const wasLocked = isAvancementFieldLocked(currentValue, field);
        const nextLocks = {
          ...currentLocks,
          [field]: !wasLocked,
        };

        const montantHT = parseNumber(currentValue.montantHT);
        const avancementReel = parsePercent(currentValue.avancementReel);
        const pctFacture = parsePercent(currentValue.pctFacture);
        const autoPctProvisionner = avancementReel - pctFacture;
        const effectivePctProvisionner = isAvancementFieldLocked(currentValue, "pctProvisionner")
          ? autoPctProvisionner
          : parsePercent(currentValue.pctProvisionner);
        const autoCaProvisionner = montantHT * effectivePctProvisionner;

        const nextValue = {
          ...currentValue,
          lockedFields: nextLocks,
        };

        // Quand on déverrouille une valeur calculée, on inscrit la valeur automatique actuelle
        // pour pouvoir la modifier manuellement sans repartir d'un champ vide.
        if (wasLocked && field === "pctProvisionner") {
          nextValue.pctProvisionner = autoPctProvisionner;
        }

        if (wasLocked && field === "caProvisionner") {
          nextValue.caProvisionner = autoCaProvisionner;
        }

        return {
          ...row,
          values: {
            ...row.values,
            [periodId]: nextValue,
          },
        };
      }),
    }));
    setDirty(true);
  };

  const addAvancementPeriod = () => {
    const label = window.prompt("Nom du nouvel onglet d'avancement", "30/06/26");
    if (!label || !label.trim()) return;

    const newPeriod = {
      id: createId("periode"),
      label: label.trim(),
    };

    setAvancement(prev => {
      const previousPeriodId = activeAvancementPeriodId || prev.periods[0]?.id;
      const previousRows = prev.rows.filter(row => Boolean(row.values?.[previousPeriodId]));
      const maxSourceRow = previousRows.reduce((max, row) => {
        const sourceRow = parseNumber(row.values?.[previousPeriodId]?.sourceRow) || 0;
        return Math.max(max, sourceRow);
      }, 0);

      const existingWithoutPreviousData = prev.rows.filter(row => !row.values?.[previousPeriodId]);
      const inheritedRows = previousRows.map((row, index) => {
        const previousValue = row.values?.[previousPeriodId] || emptyAvancementValue();

        return {
          ...row,
          values: {
            ...row.values,
            [newPeriod.id]: createInheritedAvancementValue(
              {
                ...previousValue,
                sourceRow: previousValue.sourceRow ?? index + 1,
              },
              previousPeriodId
            ),
          },
        };
      });

      const nextRows = [
        ...inheritedRows,
        ...existingWithoutPreviousData.map((row, index) => ({
          ...row,
          values: {
            ...row.values,
            [newPeriod.id]: {
              ...createNewAvancementValue(),
              devis: row.devis ?? "",
              chantier: row.chantier ?? "",
              sourceRow: maxSourceRow + index + 1,
            },
          },
        })),
      ];

      return {
        ...prev,
        periods: [newPeriod, ...prev.periods],
        rows: nextRows,
      };
    });

    setActiveAvancementPeriodId(newPeriod.id);
    setDirty(true);
  };

  const removeAvancementPeriod = (periodId) => {
    if (avancement.periods.length <= 1) {
      alert("Impossible de supprimer le dernier mois d'avancement.");
      return;
    }

    if (!window.confirm("Supprimer cet onglet d'avancement et les données associées ?")) return;

    setAvancement(prev => {
      const nextPeriods = prev.periods.filter(period => period.id !== periodId);
      const nextRows = prev.rows.map(row => {
        const nextValues = { ...(row.values || {}) };
        delete nextValues[periodId];
        return { ...row, values: nextValues };
      });

      setActiveAvancementPeriodId(nextPeriods[0]?.id || DEFAULT_AVANCEMENT_PERIODS[0].id);

      return {
        ...prev,
        periods: nextPeriods,
        rows: nextRows,
      };
    });

    setDirty(true);
  };


  const addAchatPeriod = () => {
    const label = window.prompt("Nom du nouveau mois d'achat", getAchatPeriodLabelFromDate(new Date()));
    if (!label || !label.trim()) return;

    const newPeriod = {
      id: createId("achat_mois"),
      label: label.trim(),
    };

    setAchat(prev => ({
      ...prev,
      periods: [newPeriod, ...(prev.periods || [])],
      invoicesByPeriod: {
        ...(prev.invoicesByPeriod || {}),
        [newPeriod.id]: [],
      },
    }));

    setActiveAchatPeriodId(newPeriod.id);
    setDirty(true);
  };

  const removeAchatPeriod = (periodId) => {
    if ((achat.periods || []).length <= 1) {
      alert("Impossible de supprimer le dernier mois d'achat.");
      return;
    }

    if (!window.confirm("Supprimer ce mois d'achat et toutes les factures associées ?")) return;

    setAchat(prev => {
      const nextPeriods = (prev.periods || []).filter(period => period.id !== periodId);
      const nextInvoicesByPeriod = { ...(prev.invoicesByPeriod || {}) };
      delete nextInvoicesByPeriod[periodId];

      setActiveAchatPeriodId(nextPeriods[0]?.id || DEFAULT_ACHAT_PERIODS[0].id);

      return {
        ...prev,
        periods: nextPeriods,
        invoicesByPeriod: nextInvoicesByPeriod,
      };
    });

    setDirty(true);
  };

  const importAchatFiles = (fileList, periodId = activeAchatPeriodId) => {
    const files = Array.from(fileList || []).filter(file => file?.name && isAchatAcceptedFile(file));
    if (!files.length) {
      alert("Aucune facture compatible détectée. Formats acceptés : PDF, PNG, JPG, JPEG, WEBP.");
      return;
    }

    const safePeriodId = periodId || achat.periods?.[0]?.id || DEFAULT_ACHAT_PERIODS[0].id;
    const nextInvoices = files.map(file => createEmptyAchatInvoice(file));

    setAchat(prev => ({
      ...prev,
      invoicesByPeriod: {
        ...(prev.invoicesByPeriod || {}),
        [safePeriodId]: [
          ...nextInvoices,
          ...((prev.invoicesByPeriod || {})[safePeriodId] || []),
        ],
      },
    }));
    setDirty(true);
  };

  const addAchatInvoice = (periodId = activeAchatPeriodId) => {
    const safePeriodId = periodId || achat.periods?.[0]?.id || DEFAULT_ACHAT_PERIODS[0].id;

    setAchat(prev => ({
      ...prev,
      invoicesByPeriod: {
        ...(prev.invoicesByPeriod || {}),
        [safePeriodId]: [
          createEmptyAchatInvoice(),
          ...((prev.invoicesByPeriod || {})[safePeriodId] || []),
        ],
      },
    }));
    setDirty(true);
  };

  const updateAchatInvoice = (invoiceId, field, raw, periodId = activeAchatPeriodId) => {
    const safePeriodId = periodId || achat.periods?.[0]?.id || DEFAULT_ACHAT_PERIODS[0].id;

    setAchat(prev => ({
      ...prev,
      invoicesByPeriod: {
        ...(prev.invoicesByPeriod || {}),
        [safePeriodId]: ((prev.invoicesByPeriod || {})[safePeriodId] || []).map(invoice => (
          invoice.id === invoiceId
            ? { ...invoice, [field]: raw }
            : invoice
        )),
      },
    }));
    setDirty(true);
  };

  const removeAchatInvoice = (invoiceId, periodId = activeAchatPeriodId) => {
    if (!window.confirm("Supprimer cette facture de l'onglet Achat ?")) return;

    const safePeriodId = periodId || achat.periods?.[0]?.id || DEFAULT_ACHAT_PERIODS[0].id;

    setAchat(prev => ({
      ...prev,
      invoicesByPeriod: {
        ...(prev.invoicesByPeriod || {}),
        [safePeriodId]: ((prev.invoicesByPeriod || {})[safePeriodId] || []).filter(invoice => invoice.id !== invoiceId),
      },
    }));
    setDirty(true);
  };

  const preAnalyseAchatInvoices = (periodId = activeAchatPeriodId) => {
    // Pré-analyse front : exploite uniquement le nom des fichiers importés
    // du mois actif. Pour lire le contenu réel des PDF/images, il faudra
    // brancher ici une Edge Function avec OCR + IA.
    const safePeriodId = periodId || achat.periods?.[0]?.id || DEFAULT_ACHAT_PERIODS[0].id;

    setAchat(prev => ({
      ...prev,
      invoicesByPeriod: {
        ...(prev.invoicesByPeriod || {}),
        [safePeriodId]: ((prev.invoicesByPeriod || {})[safePeriodId] || []).map(invoice => {
          if (!invoice.fileName) return invoice;
          const draft = extractAchatDraftFromFile({ name: invoice.fileName });

          return {
            ...invoice,
            fournisseur: invoice.fournisseur || draft.fournisseur || "",
            date: invoice.date || draft.date || "",
            numeroFacture: invoice.numeroFacture || draft.numeroFacture || "",
            montantTTC: parseNumber(invoice.montantTTC) > 0 ? invoice.montantTTC : draft.montantTTC || "0",
            typologie: invoice.typologie || draft.typologie || "",
            analysisStatus: "pre_analyse_nom_fichier",
            confidence: invoice.confidence || "35",
          };
        }),
      },
    }));
    setDirty(true);
  };

  // ── Avertir avant de quitter avec des modifs non sauvegardées ──────────────
  useEffect(() => {
    if (!dirty) return;

    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Calculs ─────────────────────────────────────────────────────────────────
  const parsed = MOIS.map(m => {
    const fg = parseNumber(months[m.id]?.fg);
    const heures = parseNumber(months[m.id]?.heures);

    return {
      ...m,
      fg,
      heures,
      hasData: fg > 0 || heures > 0,
    };
  });

  const nbMoisSaisis = parsed.filter(p => p.hasData).length;
  const totalFG = parsed.reduce((s, p) => s + p.fg, 0);
  const totalH = parsed.reduce((s, p) => s + p.heures, 0);
  const moyFG = nbMoisSaisis > 0 ? totalFG / nbMoisSaisis : 0;
  const moyH = nbMoisSaisis > 0 ? totalH / nbMoisSaisis : 0;
  const tauxHoraire = moyH > 0 ? moyFG / moyH : 0;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card = T.surface;

  const cellInputStyle = {
    width: "100%",
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: RADIUS.md,
    padding: "8px 10px",
    color: T.text,
    fontFamily: "inherit",
    fontSize: 14,
    textAlign: "right",
    outline: "none",
    transition: "border-color .12s",
  };

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T.textSub,
          padding: 40,
        }}
      >
        Chargement…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg, color: T.text }}>
      <style>{`
        .ef-row:hover { background: ${T.cardHover}; }
        .ef-input:focus { border-color: ${acc.accent} !important; }
        .ef-tab:hover { background: ${T.cardHover}; }
        .ef-subtab:hover { background: ${T.cardHover}; }
        .ef-avancement-table th {
          position: sticky;
          top: 0;
          z-index: 3;
          box-shadow: 0 1px 0 ${T.border};
        }
        .ef-avancement-table th,
        .ef-avancement-table td {
          border-right: 1px solid ${T.border};
        }
        .ef-avancement-table th:last-child,
        .ef-avancement-table td:last-child {
          border-right: none;
        }
        .ef-avancement-table tbody tr:nth-child(even) td {
          background: ${T.card};
        }
        .ef-avancement-table tbody tr:nth-child(odd) td {
          background: ${T.surface};
        }
        .ef-avancement-table tbody tr:hover td {
          background: ${T.cardHover} !important;
        }
        .ef-avancement-table tbody tr.ef-completed-row td:nth-child(-n+6) {
          background: rgba(255, 226, 128, 0.22) !important;
          border-top: 1px solid rgba(245, 166, 35, 0.34);
          border-bottom: 1px solid rgba(245, 166, 35, 0.34);
        }
        .ef-avancement-table tbody tr.ef-completed-row:hover td:nth-child(-n+6) {
          background: rgba(255, 226, 128, 0.32) !important;
        }
        .ef-avancement-table tbody tr.ef-custom-color-row td:nth-child(-n+6) {
          background: var(--ef-row-color) !important;
        }
        .ef-avancement-table tbody tr.ef-custom-color-row:hover td:nth-child(-n+6) {
          background: var(--ef-row-color) !important;
          filter: brightness(0.98);
        }
        .ef-avancement-table tbody tr.ef-dragging td {
          opacity: 0.55;
        }
        .ef-avancement-table tbody tr.ef-drag-over td {
          background: ${acc.accent}18 !important;
          box-shadow: inset 0 2px 0 ${acc.accent};
        }
        .ef-drag-handle {
          cursor: grab;
          user-select: none;
        }
        .ef-drag-handle:active {
          cursor: grabbing;
        }
        .ef-color-dot:hover {
          transform: translateY(-1px) scale(1.06);
        }
        .ef-formula-head {
          position: relative;
        }
        .ef-formula-tooltip {
          display: none;
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 260px;
          max-width: 340px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid ${T.border};
          background: ${T.surface};
          color: ${T.text};
          box-shadow: 0 12px 28px rgba(0,0,0,.22);
          text-transform: none;
          letter-spacing: 0;
          font-size: 12px;
          line-height: 1.45;
          white-space: normal;
          z-index: 20;
        }
        .ef-formula-head:hover .ef-formula-tooltip {
          display: block;
        }
        @media (max-width: 767px) {
          .ef-wrap { padding: 14px 12px !important; }
          .ef-kpis { grid-template-columns: 1fr !important; }
          .ef-tabs { overflow-x: auto; padding-bottom: 4px; }
          .ef-tab { white-space: nowrap; }
          .ef-actions { width: 100%; justify-content: flex-start !important; }
        }
      `}</style>

      <div
        className="ef-wrap"
        style={{
          padding: activeTab === "avancement_chantier" || activeTab === "achat" ? "24px 20px" : "24px 32px",
          maxWidth: activeTab === "avancement_chantier" || activeTab === "achat" ? "none" : 1220,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        {/* ─── Header ─────────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: acc.accent,
                opacity: 0.75,
                marginBottom: 4,
              }}
            >
              Suivi mensuel · Annuel
            </div>

            <div style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: 0.3 }}>
              États financiers
            </div>
          </div>

          <div className="ef-actions" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
            {dirty && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: RADIUS.pill,
                  background: "rgba(245,166,35,0.12)",
                  color: "#f5a623",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                }}
              >
                ● Modifications non sauvegardées
              </span>
            )}

            {!dirty && lastSavedAt && (
              <span style={{ fontSize: 12, color: T.textMuted }}>
                Enregistré à{" "}
                {lastSavedAt.toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}

            <button
              onClick={save}
              disabled={saving || !dirty}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 18px",
                borderRadius: RADIUS.md,
                border: "none",
                cursor: saving || !dirty ? "not-allowed" : "pointer",
                background: saving || !dirty ? T.card : acc.accent,
                color: saving || !dirty ? T.textMuted : "#111",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                opacity: saving || !dirty ? 0.6 : 1,
                transition: "background .12s, opacity .12s",
              }}
            >
              <Icon as={Save} size={14} />
              {saving ? "Enregistrement…" : "Sauvegarder"}
            </button>
          </div>
        </div>

        {/* ─── Onglets internes ──────────────────────────────────────────────── */}
        <div
          className="ef-tabs"
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 22,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="ef-tab"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "11px 14px",
                  border: "none",
                  borderBottom: `2px solid ${isActive ? acc.accent : "transparent"}`,
                  background: isActive ? `${acc.accent}12` : "transparent",
                  color: isActive ? acc.accent : T.textSub,
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 0.2,
                  cursor: "pointer",
                  borderTopLeftRadius: RADIUS.md,
                  borderTopRightRadius: RADIUS.md,
                  transition: "background .12s, color .12s, border-color .12s",
                }}
              >
                <Icon as={tab.icon} size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ─── Contenu des onglets ───────────────────────────────────────────── */}
        {activeTab === "frais_generaux" && (
          <FraisGenerauxTab
            T={T}
            acc={acc}
            card={card}
            months={months}
            updateField={updateField}
            parsed={parsed}
            nbMoisSaisis={nbMoisSaisis}
            totalFG={totalFG}
            totalH={totalH}
            moyFG={moyFG}
            moyH={moyH}
            tauxHoraire={tauxHoraire}
            cellInputStyle={cellInputStyle}
          />
        )}

        {activeTab === "avancement_chantier" && (
          <AvancementChantierTab
            T={T}
            acc={acc}
            avancement={avancement}
            activePeriodId={activeAvancementPeriodId}
            setActivePeriodId={setActiveAvancementPeriodId}
            addPeriod={addAvancementPeriod}
            removePeriod={removeAvancementPeriod}
            addRow={addAvancementRow}
            removeRow={removeAvancementRow}
            reorderRows={reorderAvancementRows}
            updateRow={updateAvancementRow}
            updateValue={updateAvancementValue}
            toggleLock={toggleAvancementLock}
          />
        )}

        {activeTab === "achat" && (
          <AchatTab
            T={T}
            acc={acc}
            achat={achat}
            activePeriodId={activeAchatPeriodId}
            setActivePeriodId={setActiveAchatPeriodId}
            addPeriod={addAchatPeriod}
            removePeriod={removeAchatPeriod}
            importFiles={importAchatFiles}
            addInvoice={addAchatInvoice}
            updateInvoice={updateAchatInvoice}
            removeInvoice={removeAchatInvoice}
            preAnalyseInvoices={preAnalyseAchatInvoices}
          />
        )}

        {activeTab === "situation" && (
          <PlaceholderTab
            T={T}
            icon={Euro}
            title="Situation"
            description="Cet onglet servira à suivre les situations de travaux, les factures émises, les montants encaissés, les restes à facturer et les restes à encaisser."
          />
        )}

        {activeTab === "analyse_financiere" && (
          <PlaceholderTab
            T={T}
            icon={TrendingUp}
            title="Analyse financière"
            description="Cet onglet servira à regrouper les indicateurs financiers clés : chiffre d’affaires, marge, frais généraux, rentabilité, trésorerie et analyse globale de performance."
          />
        )}
      </div>
    </div>
  );
}

// ─── ONGLET 1 : FRAIS GÉNÉRAUX ────────────────────────────────────────────────
function FraisGenerauxTab({
  T,
  acc,
  card,
  months,
  updateField,
  nbMoisSaisis,
  totalFG,
  totalH,
  moyFG,
  moyH,
  tauxHoraire,
  cellInputStyle,
}) {
  return (
    <>
      {/* ─── KPI : moyennes + taux horaire ──────────────────────────────────── */}
      <div
        className="ef-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <KpiCard
          T={T}
          icon={Euro}
          iconColor="#ff9a4d"
          label="Moyenne FG / mois"
          value={fmtEur(moyFG)}
        />

        <KpiCard
          T={T}
          icon={Clock}
          iconColor="#5b9cf6"
          label="Moyenne Heures / mois"
          value={fmtH(moyH)}
        />

        <KpiCard
          T={T}
          icon={Calculator}
          iconColor={acc.accent}
          label="Taux horaire FG"
          value={fmtTaux(tauxHoraire)}
          highlight
        />
      </div>

      {/* ─── Tableau mensuel ────────────────────────────────────────────────── */}
      <div
        style={{
          background: card,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg,
          padding: 18,
          marginBottom: 20,
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: T.textSub,
                  }}
                >
                  Mois
                </th>

                <th
                  style={{
                    textAlign: "right",
                    padding: "10px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: T.textSub,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon as={Euro} size={12} /> Frais Généraux
                  </span>
                </th>

                <th
                  style={{
                    textAlign: "right",
                    padding: "10px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: T.textSub,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon as={Clock} size={12} /> Heures / mois
                  </span>
                </th>
              </tr>
            </thead>

            <tbody>
              {MOIS.map(m => (
                <tr
                  key={m.id}
                  className="ef-row"
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    transition: "background .12s",
                  }}
                >
                  <td style={{ padding: "8px 12px", fontSize: 14, fontWeight: 600, color: T.text }}>
                    {m.label}
                  </td>

                  <td style={{ padding: "6px 12px", width: "30%" }}>
                    <input
                      className="ef-input"
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      placeholder="0"
                      value={months[m.id]?.fg ?? ""}
                      onChange={e => updateField(m.id, "fg", e.target.value)}
                      style={cellInputStyle}
                    />
                  </td>

                  <td style={{ padding: "6px 12px", width: "30%" }}>
                    <input
                      className="ef-input"
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      placeholder="0"
                      value={months[m.id]?.heures ?? ""}
                      onChange={e => updateField(m.id, "heures", e.target.value)}
                      style={cellInputStyle}
                    />
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr style={{ background: T.card }}>
                <td
                  style={{
                    padding: "12px",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: T.textSub,
                  }}
                >
                  Total ({nbMoisSaisis} mois saisis)
                </td>

                <td style={{ padding: "12px", textAlign: "right", fontSize: 14, fontWeight: 700, color: T.text }}>
                  {fmtEur(totalFG)}
                </td>

                <td style={{ padding: "12px", textAlign: "right", fontSize: 14, fontWeight: 700, color: T.text }}>
                  {fmtH(totalH)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ─── Note explicative ───────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 14px",
          borderRadius: RADIUS.md,
          background: T.card,
          border: `1px solid ${T.border}`,
          fontSize: 12.5,
          color: T.textSub,
          lineHeight: 1.55,
        }}
      >
        <Icon as={Info} size={14} style={{ marginTop: 2, flexShrink: 0, color: T.textMuted }} />

        <div>
          Le <strong style={{ color: T.text }}>taux horaire FG</strong> est calculé comme{" "}
          <em>moyenne FG / moyenne heures</em> sur les mois saisis. Cette valeur est indicative —
          Phasage v2 conserve sa propre saisie par chantier pour ne pas modifier les calculs passés.
        </div>
      </div>
    </>
  );
}

// ─── ONGLET 2 : AVANCEMENT DE CHANTIER ───────────────────────────────────────
function AvancementChantierTab({
  T,
  acc,
  avancement,
  activePeriodId,
  setActivePeriodId,
  addPeriod,
  removePeriod,
  addRow,
  removeRow,
  reorderRows,
  updateRow,
  updateValue,
  toggleLock,
}) {
  const periods = avancement.periods || [];
  const rows = avancement.rows || [];
  const activePeriod = periods.find(period => period.id === activePeriodId) || periods[0];
  const currentPeriodId = activePeriod?.id;
  const [draggedRowId, setDraggedRowId] = useState(null);

  const inputBase = {
    width: "100%",
    minWidth: 90,
    background: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: RADIUS.md,
    padding: "8px 10px",
    color: T.text,
    fontFamily: "inherit",
    fontSize: 13,
    outline: "none",
    transition: "border-color .12s, box-shadow .12s, background .12s",
    boxSizing: "border-box",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  };

  const numberInput = {
    ...inputBase,
    textAlign: "right",
  };

  const textInput = {
    ...inputBase,
    textAlign: "left",
  };

  const calculatedCell = {
    width: "100%",
    minWidth: 90,
    background: `${acc.accent}12`,
    border: `1px solid ${acc.accent}44`,
    borderRadius: RADIUS.md,
    padding: "8px 10px",
    fontSize: 13,
    fontWeight: 900,
    textAlign: "right",
    boxSizing: "border-box",
    boxShadow: `inset 0 0 0 1px ${acc.accent}12`,
  };

  const computedRows = rows
    .map(row => {
      const hasPeriodData = Boolean(
        currentPeriodId &&
        row.values &&
        Object.prototype.hasOwnProperty.call(row.values, currentPeriodId)
      );
      const values = row.values?.[currentPeriodId] || {};
      const montantHT = parseNumber(values.montantHT);
      const avancementReel = parsePercent(values.avancementReel);
      const pctFacture = parsePercent(values.pctFacture);
      const pctProvisionnerLocked = isAvancementFieldLocked(values, "pctProvisionner");
      const caProvisionnerLocked = isAvancementFieldLocked(values, "caProvisionner");
      // Colonnes automatisées comme dans le fichier Excel :
      // H = avancement réel - % facturé
      // I = montant total HT × % à provisionner
      const autoPctProvisionner = avancementReel - pctFacture;
      const pctProvisionner = pctProvisionnerLocked
        ? autoPctProvisionner
        : parsePercent(values.pctProvisionner);
      const autoCaProvisionner = montantHT * pctProvisionner;
      const caProvisionner = caProvisionnerLocked
        ? autoCaProvisionner
        : parseNumber(values.caProvisionner);

      return {
        row,
        values,
        hasPeriodData,
        montantHT,
        avancementReel,
        pctFacture,
        autoPctProvisionner,
        pctProvisionner,
        autoCaProvisionner,
        caProvisionner,
        pctProvisionnerLocked,
        caProvisionnerLocked,
        isCompleted: avancementReel >= 1,
        sourceRow: parseNumber(values.sourceRow) || 9999,
      };
    })
    .filter(item => item.hasPeriodData)
    .sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      return a.sourceRow - b.sourceRow;
    });

  const totalHT = computedRows.reduce((sum, item) => sum + item.montantHT, 0);
  const totalProvisionner = computedRows.reduce((sum, item) => sum + item.caProvisionner, 0);
  const moyenneAvancement = computedRows.length > 0
    ? computedRows.reduce((sum, item) => sum + item.avancementReel, 0) / computedRows.length
    : 0;

  return (
    <>
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>
              Avancement de chantier
            </div>
            <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 4 }}>
              À la création d'un nouveau mois, les chantiers du mois précédent sont repris automatiquement. Les lignes à 100 % d'avancement restent classées en bas. Tu peux déplacer les lignes par glisser-déposer, colorier les lignes de ton choix et classer les chantiers par client.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={addPeriod}
              style={actionButtonStyle(acc.accent, "#111")}
            >
              <Icon as={CalendarPlus} size={14} />
              Ajouter un mois
            </button>

            <button
              onClick={addRow}
              style={actionButtonStyle(T.card, T.text, T.border)}
            >
              <Icon as={Plus} size={14} />
              Ajouter un chantier
            </button>

          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 2,
          }}
        >
          {periods.map(period => {
            const isActive = period.id === currentPeriodId;

            return (
              <button
                key={period.id}
                onClick={() => setActivePeriodId(period.id)}
                className="ef-subtab"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  whiteSpace: "nowrap",
                  padding: "8px 12px",
                  borderRadius: RADIUS.pill,
                  border: `1px solid ${isActive ? acc.accent : T.border}`,
                  background: isActive ? `${acc.accent}18` : T.card,
                  color: isActive ? acc.accent : T.textSub,
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                <Icon as={FileSpreadsheet} size={13} />
                {period.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 12,
            fontSize: 12,
            color: T.textSub,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              borderRadius: RADIUS.pill,
              background: T.bg,
              border: `1px solid ${T.border}`,
              fontWeight: 800,
            }}
          >
            Champs modifiables
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              borderRadius: RADIUS.pill,
              background: "rgba(245,166,35,0.10)",
              border: "1px solid rgba(245,166,35,0.30)",
              color: "#f5a623",
              fontWeight: 900,
            }}
          >
            <Icon as={Lock} size={12} /> Valeurs reprises du mois précédent
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              borderRadius: RADIUS.pill,
              background: `${acc.accent}12`,
              border: `1px solid ${acc.accent}44`,
              color: acc.accent,
              fontWeight: 900,
            }}
          >
            <Icon as={Lock} size={12} /> Colonnes calculées figées
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              borderRadius: RADIUS.pill,
              background: "rgba(255, 226, 128, 0.22)",
              border: "1px solid rgba(245,166,35,0.34)",
              color: "#f5a623",
              fontWeight: 900,
            }}
          >
            Ligne jaune pâle = chantier terminé / 100 %
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              borderRadius: RADIUS.pill,
              background: "rgba(91,156,246,0.10)",
              border: "1px solid rgba(91,156,246,0.30)",
              color: "#5b9cf6",
              fontWeight: 900,
            }}
          >
            Couleurs prédéfinies par ligne
          </span>
          <span>Survole les en-têtes ou les cellules calculées pour lire les formules. Clique sur un cadenas pour modifier une valeur reprise ou une valeur calculée. Utilise la colonne Couleur à gauche pour choisir une teinte prédéfinie via le menu déroulant. Attrape la poignée dans la colonne Déplacer pour réordonner les lignes par client.</span>
        </div>
      </div>

      <div
        className="ef-kpis"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <KpiCard
          T={T}
          icon={FileSpreadsheet}
          iconColor="#5b9cf6"
          label="Chantiers suivis"
          value={String(computedRows.length)}
        />
        <KpiCard
          T={T}
          icon={Euro}
          iconColor="#ff9a4d"
          label="Total marchés HT"
          value={fmtEur(totalHT)}
        />
        <KpiCard
          T={T}
          icon={TrendingUp}
          iconColor={totalProvisionner >= 0 ? acc.accent : "#ff5c5c"}
          label="Total à provisionner"
          value={fmtEur(totalProvisionner)}
          highlight
        />
      </div>

      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: T.textSub }}>
            Mois affiché : <strong style={{ color: T.text }}>{activePeriod?.label || "Aucun mois"}</strong>
          </div>

          <button
            onClick={() => removePeriod(currentPeriodId)}
            disabled={!currentPeriodId || periods.length <= 1}
            style={{
              ...actionButtonStyle("rgba(255,92,92,0.12)", "#ff5c5c", "rgba(255,92,92,0.28)"),
              opacity: !currentPeriodId || periods.length <= 1 ? 0.45 : 1,
              cursor: !currentPeriodId || periods.length <= 1 ? "not-allowed" : "pointer",
            }}
          >
            <Icon as={Trash2} size={14} />
            Supprimer le mois
          </button>
        </div>

        <div
          style={{
            overflowX: "auto",
            width: "100%",
            border: `1px solid ${T.border}`,
            borderRadius: RADIUS.lg,
            boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
          }}
        >
          <table className="ef-avancement-table" style={{ width: "100%", minWidth: 2240, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <AvancementTh T={T}>Couleur</AvancementTh>
                <AvancementTh T={T}>Déplacer</AvancementTh>
                <AvancementTh T={T} align="left">Devis</AvancementTh>
                <AvancementTh T={T} align="left">Nom du chantier</AvancementTh>
                <AvancementTh T={T}>Montant total HT</AvancementTh>
                <AvancementTh T={T}>Montant total TTC</AvancementTh>
                <AvancementTh T={T}>Avancement précédent</AvancementTh>
                <AvancementTh T={T}>Avancement réel</AvancementTh>
                <AvancementTh T={T}>% facturé</AvancementTh>
                <AvancementTh T={T} calculated accentColor={acc.accent} formula="Avancement réel - % facturé">
                  % à provisionner
                </AvancementTh>
                <AvancementTh T={T} calculated accentColor={acc.accent} formula="Montant total HT × % à provisionner">
                  CA HT à provisionner
                </AvancementTh>
                <AvancementTh T={T}>% acompte mois</AvancementTh>
                <AvancementTh T={T}>% acompte précédent</AvancementTh>
                <AvancementTh T={T} align="left">Commentaire</AvancementTh>
                <AvancementTh T={T}>Action</AvancementTh>
              </tr>
            </thead>

            <tbody>
              {computedRows.length === 0 && (
                <tr>
                  <td colSpan={15} style={{ padding: "28px 12px", textAlign: "center", color: T.textSub, fontSize: 14 }}>
                    Aucun chantier saisi pour ce mois. Clique sur <strong style={{ color: T.text }}>Ajouter un chantier</strong> pour commencer.
                  </td>
                </tr>
              )}

              {computedRows.map(({ row, values, montantHT, avancementReel, pctFacture, autoPctProvisionner, pctProvisionner, autoCaProvisionner, caProvisionner, pctProvisionnerLocked, caProvisionnerLocked, isCompleted }) => {
                const rowColor = normalizeRowColor(values.rowColor);
                return (
                <tr
                  key={row.id}
                  className={`${isCompleted ? "ef-row ef-completed-row" : "ef-row"}${rowColor ? " ef-custom-color-row" : ""}${draggedRowId === row.id ? " ef-dragging" : ""}`}
                  title={isCompleted ? "Chantier terminé à 100 % : classé automatiquement en bas de tableau" : undefined}
                  onDragOver={e => {
                    e.preventDefault();
                    e.currentTarget.classList.add("ef-drag-over");
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDragLeave={e => e.currentTarget.classList.remove("ef-drag-over")}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("ef-drag-over");
                    const sourceId = e.dataTransfer.getData("text/plain") || draggedRowId;
                    if (sourceId && sourceId !== row.id) {
                      reorderRows(sourceId, row.id, currentPeriodId);
                    }
                    setDraggedRowId(null);
                  }}
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    ...(rowColor ? { "--ef-row-color": rowColor } : {}),
                  }}
                >
                  <td style={{ padding: "7px 8px", width: 150, textAlign: "center" }}>
                    <RowColorSelect
                      T={T}
                      value={rowColor}
                      onChange={color => updateValue(row.id, currentPeriodId, "rowColor", color)}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 92, textAlign: "center" }}>
                    <div
                      className="ef-drag-handle"
                      draggable
                      onDragStart={e => {
                        setDraggedRowId(row.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", row.id);
                      }}
                      onDragEnd={() => setDraggedRowId(null)}
                      title={isCompleted
                        ? "Déplacer ce chantier dans le bloc des chantiers terminés"
                        : "Déplacer ce chantier"}
                      style={dragHandleStyle(T)}
                    >
                      <Icon as={GripVertical} size={15} />
                      <span>Glisser</span>
                    </div>
                  </td>

                  <td style={{ padding: "7px 8px", width: 120 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      value={values.devis ?? row.devis ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "devis", e.target.value)}
                      placeholder="D-250000"
                      style={textInput}
                      locked={isAvancementFieldLocked(values, "devis")}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "devis")}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 230 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      value={values.chantier ?? row.chantier ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "chantier", e.target.value)}
                      placeholder="Nom du chantier"
                      style={{ ...textInput, minWidth: 210 }}
                      locked={isAvancementFieldLocked(values, "chantier")}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "chantier")}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 130 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      type="number"
                      step="0.01"
                      value={values.montantHT ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "montantHT", e.target.value)}
                      placeholder="0"
                      style={numberInput}
                      locked={isAvancementFieldLocked(values, "montantHT")}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "montantHT")}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 130 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      type="number"
                      step="0.01"
                      value={values.montantTTC ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "montantTTC", e.target.value)}
                      placeholder="0"
                      style={numberInput}
                      locked={isAvancementFieldLocked(values, "montantTTC")}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "montantTTC")}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 120 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      type="number"
                      step="0.01"
                      value={values.avancementPrecedent ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "avancementPrecedent", e.target.value)}
                      placeholder="0,50"
                      style={numberInput}
                      locked={isAvancementFieldLocked(values, "avancementPrecedent")}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "avancementPrecedent")}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 120 }}>
                    <input
                      className="ef-input"
                      type="number"
                      step="0.01"
                      value={values.avancementReel ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "avancementReel", e.target.value)}
                      placeholder="0,69"
                      style={numberInput}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 115 }}>
                    <input
                      className="ef-input"
                      type="number"
                      step="0.01"
                      value={values.pctFacture ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "pctFacture", e.target.value)}
                      placeholder="0,68"
                      style={numberInput}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 140 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      type={pctProvisionnerLocked ? "text" : "number"}
                      step="0.01"
                      value={pctProvisionnerLocked ? fmtPct(pctProvisionner) : (values.pctProvisionner ?? "")}
                      onChange={e => updateValue(row.id, currentPeriodId, "pctProvisionner", e.target.value)}
                      placeholder="0"
                      style={{
                        ...calculatedCell,
                        color: pctProvisionner >= 0 ? acc.accent : "#ff5c5c",
                        background: pctProvisionnerLocked ? calculatedCell.background : T.bg,
                      }}
                      locked={pctProvisionnerLocked}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "pctProvisionner")}
                      title={pctProvisionnerLocked
                        ? `Formule figée : ${fmtPct(avancementReel)} - ${fmtPct(pctFacture)} = ${fmtPct(autoPctProvisionner)}`
                        : "Valeur déverrouillée : saisie manuelle"}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 170 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      type={caProvisionnerLocked ? "text" : "number"}
                      step="0.01"
                      value={caProvisionnerLocked ? fmtEur(caProvisionner) : (values.caProvisionner ?? "")}
                      onChange={e => updateValue(row.id, currentPeriodId, "caProvisionner", e.target.value)}
                      placeholder="0"
                      style={{
                        ...calculatedCell,
                        minWidth: 150,
                        color: caProvisionner >= 0 ? T.text : "#ff5c5c",
                        background: caProvisionnerLocked ? calculatedCell.background : T.bg,
                      }}
                      locked={caProvisionnerLocked}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "caProvisionner")}
                      title={caProvisionnerLocked
                        ? `Formule figée : ${fmtEur(montantHT)} × ${fmtPct(pctProvisionner)} = ${fmtEur(autoCaProvisionner)}`
                        : "Valeur déverrouillée : saisie manuelle"}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 120 }}>
                    <input
                      className="ef-input"
                      type="number"
                      step="0.01"
                      value={values.acompteMois ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "acompteMois", e.target.value)}
                      placeholder="0,70"
                      style={numberInput}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 130 }}>
                    <LockedInput
                      T={T}
                      acc={acc}
                      iconLocked={Lock}
                      iconUnlocked={Unlock}
                      type="number"
                      step="0.01"
                      value={values.acomptePrecedent ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "acomptePrecedent", e.target.value)}
                      placeholder="0,70"
                      style={numberInput}
                      locked={isAvancementFieldLocked(values, "acomptePrecedent")}
                      onToggleLock={() => toggleLock(row.id, currentPeriodId, "acomptePrecedent")}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 180 }}>
                    <input
                      className="ef-input"
                      value={values.note ?? ""}
                      onChange={e => updateValue(row.id, currentPeriodId, "note", e.target.value)}
                      placeholder="Commentaire"
                      style={{ ...textInput, minWidth: 160 }}
                    />
                  </td>

                  <td style={{ padding: "7px 8px", width: 70, textAlign: "center" }}>
                    <button
                      onClick={() => removeRow(row.id)}
                      title="Supprimer le chantier"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        border: `1px solid rgba(255,92,92,0.28)`,
                        background: "rgba(255,92,92,0.10)",
                        color: "#ff5c5c",
                        cursor: "pointer",
                      }}
                    >
                      <Icon as={Trash2} size={14} />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr style={{ background: T.card }}>
                <td colSpan={4} style={{ padding: "12px", fontSize: 12, fontWeight: 800, color: T.textSub, textTransform: "uppercase", letterSpacing: 1 }}>
                  Total avancement
                </td>
                <td style={{ padding: "12px", textAlign: "right", fontSize: 13, fontWeight: 800, color: T.text }}>
                  {fmtEur(totalHT)}
                </td>
                <td colSpan={5} style={{ padding: "12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: T.textSub }}>
                  Avancement moyen : {fmtPct(moyenneAvancement)}
                </td>
                <td style={{ padding: "12px", textAlign: "right", fontSize: 13, fontWeight: 900, color: totalProvisionner >= 0 ? acc.accent : "#ff5c5c" }}>
                  {fmtEur(totalProvisionner)}
                </td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 14px",
          borderRadius: RADIUS.md,
          background: T.card,
          border: `1px solid ${T.border}`,
          fontSize: 12.5,
          color: T.textSub,
          lineHeight: 1.55,
        }}
      >
        <Icon as={Info} size={14} style={{ marginTop: 2, flexShrink: 0, color: T.textMuted }} />
        <div>
          Le <strong style={{ color: T.text }}>% à provisionner</strong> est automatique et figé par défaut : <em>avancement réel - % facturé</em>. Le <strong style={{ color: T.text }}>CA HT à provisionner</strong> est aussi figé par défaut : <em>montant HT × % à provisionner</em>. Clique sur le cadenas pour déverrouiller une valeur héritée ou une valeur calculée. Les chantiers avec un avancement réel de 1, soit 100 %, sont affichés en jaune pâle et conservés en bas du tableau. Utilise la poignée <strong style={{ color: T.text }}>Glisser</strong> pour déplacer les lignes et classer les chantiers par client. La colonne <strong style={{ color: T.text }}>Couleur</strong>, désormais placée tout à gauche, applique la teinte uniquement sur les 6 premières colonnes, de <strong style={{ color: T.text }}>Couleur</strong> à <strong style={{ color: T.text }}>Montant total TTC</strong>.
        </div>
      </div>
    </>
  );
}

function normalizeRowColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "";
}

function RowColorSelect({ T, value, onChange }) {
  const selectedColor = AVANCEMENT_ROW_COLOR_PALETTE.find(color => color.value === value);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
      }}
    >
      <span
        title={selectedColor ? selectedColor.label : "Aucune couleur"}
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: selectedColor ? selectedColor.value : "transparent",
          border: selectedColor ? `2px solid ${T.text}33` : `1px dashed ${T.border}`,
          flexShrink: 0,
        }}
      />

      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        title="Choisir une couleur prédéfinie"
        aria-label="Choisir une couleur prédéfinie pour la ligne"
        style={{
          width: 104,
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.md,
          padding: "6px 8px",
          color: T.text,
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          outline: "none",
          cursor: "pointer",
        }}
      >
        <option value="">Aucune</option>
        {AVANCEMENT_ROW_COLOR_PALETTE.map(color => (
          <option key={color.value} value={color.value}>
            {color.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function dragHandleStyle(T) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minWidth: 74,
    padding: "7px 8px",
    borderRadius: 9,
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.textSub,
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 0.2,
  };
}

function LockedInput({
  T,
  acc,
  iconLocked,
  iconUnlocked,
  locked = false,
  onToggleLock,
  style,
  ...inputProps
}) {
  const canToggle = typeof onToggleLock === "function";
  const icon = locked ? iconLocked : iconUnlocked;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        className="ef-input"
        {...inputProps}
        disabled={locked}
        style={{
          ...style,
          paddingRight: canToggle ? 34 : style?.paddingRight,
          background: locked ? "rgba(245,166,35,0.08)" : style?.background,
          border: locked ? "1px solid rgba(245,166,35,0.38)" : style?.border,
          color: locked ? T.textSub : style?.color,
          cursor: locked ? "not-allowed" : "text",
        }}
      />

      {canToggle && (
        <button
          type="button"
          onClick={onToggleLock}
          title={locked ? "Valeur reprise du mois précédent — cliquer pour déverrouiller" : "Valeur déverrouillée — cliquer pour reverrouiller"}
          style={{
            position: "absolute",
            top: "50%",
            right: 6,
            transform: "translateY(-50%)",
            width: 24,
            height: 24,
            borderRadius: 7,
            border: locked ? "1px solid rgba(245,166,35,0.42)" : `1px solid ${T.border}`,
            background: locked ? "rgba(245,166,35,0.13)" : T.card,
            color: locked ? "#f5a623" : T.textMuted,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon as={icon} size={12} />
        </button>
      )}
    </div>
  );
}

function AvancementTh({ T, children, align = "right", formula = null, calculated = false, accentColor = "#d7b46a" }) {
  const alignItems = align === "left" ? "flex-start" : "flex-end";

  return (
    <th
      className={formula ? "ef-formula-head" : undefined}
      title={formula ? `Formule : ${formula}` : undefined}
      style={{
        textAlign: align,
        padding: "11px 9px",
        fontSize: 10.5,
        fontWeight: 900,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: calculated ? accentColor : T.textSub,
        whiteSpace: "nowrap",
        background: calculated ? `${accentColor}16` : T.card,
        borderBottom: `1px solid ${T.border}`,
        verticalAlign: "top",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems, gap: 4 }}>
        <span>{children}</span>

        {formula && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: RADIUS.pill,
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}40`,
              color: accentColor,
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            fx · survol
          </span>
        )}

        {formula && (
          <div className="ef-formula-tooltip">
            <div style={{ fontSize: 11, fontWeight: 900, color: accentColor, marginBottom: 3 }}>
              Formule automatique
            </div>
            <div>{formula}</div>
          </div>
        )}
      </div>
    </th>
  );
}

function actionButtonStyle(background, color, border = "transparent") {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: RADIUS.md,
    border: `1px solid ${border}`,
    background,
    color,
    fontFamily: "inherit",
    fontSize: 12.5,
    fontWeight: 800,
    cursor: "pointer",
  };
}


// ─── ONGLET ACHAT ─────────────────────────────────────────────────────────────
function AchatTab({
  T,
  acc,
  achat,
  activePeriodId,
  setActivePeriodId,
  addPeriod,
  removePeriod,
  importFiles,
  addInvoice,
  updateInvoice,
  removeInvoice,
  preAnalyseInvoices,
}) {
  const folderInputRef = useRef(null);
  const filesInputRef = useRef(null);
  const periods = achat?.periods?.length ? achat.periods : DEFAULT_ACHAT_PERIODS;
  const currentPeriodId = activePeriodId || periods[0]?.id || DEFAULT_ACHAT_PERIODS[0].id;
  const currentPeriod = periods.find(period => period.id === currentPeriodId) || periods[0] || DEFAULT_ACHAT_PERIODS[0];
  const invoicesByPeriod = achat?.invoicesByPeriod || {};
  const invoices = invoicesByPeriod[currentPeriodId] || [];
  const allInvoicesCount = Object.values(invoicesByPeriod).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const totalHT = invoices.reduce((sum, invoice) => sum + parseNumber(invoice.montantHT), 0);
  const totalTTC = invoices.reduce((sum, invoice) => sum + parseNumber(invoice.montantTTC), 0);
  const nbAControler = invoices.filter(invoice => invoice.controle === "a_controler").length;
  const nbAPayer = invoices.filter(invoice => invoice.reglement === "a_regler" || invoice.reglement === "partiel").length;

  const inputStyle = {
    width: "100%",
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: RADIUS.sm,
    padding: "7px 8px",
    color: T.text,
    fontFamily: "inherit",
    fontSize: 12.5,
    outline: "none",
    boxSizing: "border-box",
  };

  const selectStyle = {
    ...inputStyle,
    cursor: "pointer",
  };

  const buttonStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "9px 12px",
    borderRadius: RADIUS.md,
    border: `1px solid ${T.border}`,
    background: T.card,
    color: T.text,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  };

  const activeTabStyle = {
    ...buttonStyle,
    background: `${acc.accent}14`,
    color: acc.accent,
    borderColor: `${acc.accent}66`,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg,
          padding: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {periods.map(period => {
            const isActive = period.id === currentPeriodId;
            const count = (invoicesByPeriod[period.id] || []).length;

            return (
              <button
                key={period.id}
                type="button"
                onClick={() => setActivePeriodId(period.id)}
                style={isActive ? activeTabStyle : buttonStyle}
              >
                <Icon as={CalendarPlus} size={14} />
                {period.label}
                <span
                  style={{
                    minWidth: 20,
                    height: 20,
                    padding: "0 6px",
                    borderRadius: RADIUS.pill,
                    background: isActive ? `${acc.accent}22` : T.surface,
                    border: `1px solid ${isActive ? `${acc.accent}44` : T.border}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={addPeriod} style={{ ...buttonStyle, background: acc.accent, borderColor: acc.accent, color: "#111" }}>
            <Icon as={Plus} size={14} />
            Ajouter un mois
          </button>

          <button
            type="button"
            onClick={() => removePeriod(currentPeriodId)}
            disabled={periods.length <= 1}
            style={{
              ...buttonStyle,
              color: periods.length <= 1 ? T.textMuted : "#ef4444",
              opacity: periods.length <= 1 ? 0.55 : 1,
              cursor: periods.length <= 1 ? "not-allowed" : "pointer",
            }}
          >
            <Icon as={Trash2} size={14} />
            Supprimer le mois
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(180px, 1fr))",
          gap: 14,
        }}
      >
        <KpiCard T={T} icon={FileText} iconColor="#5b9cf6" label={`Factures ${currentPeriod.label}`} value={String(invoices.length)} />
        <KpiCard T={T} icon={Euro} iconColor="#ff9a4d" label="Total HT du mois" value={fmtEur(totalHT)} />
        <KpiCard T={T} icon={CreditCard} iconColor="#a78bfa" label="Total TTC du mois" value={fmtEur(totalTTC)} />
        <KpiCard T={T} icon={AlertTriangle} iconColor="#f5a623" label="À contrôler / payer" value={`${nbAControler} / ${nbAPayer}`} highlight />
      </div>

      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: T.text }}>
            Import et analyse des factures · {currentPeriod.label}
          </div>
          <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.5, maxWidth: 850 }}>
            Les factures sont classées par mois. Tu peux importer un dossier ou plusieurs factures dans le mois actif, puis modifier fournisseur, typologie, date, numéro, montants HT/TTC, contrôle et règlement. Total tous mois confondus : {allInvoicesCount} facture{allInvoicesCount > 1 ? "s" : ""}.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            webkitdirectory=""
            directory=""
            onChange={e => {
              importFiles(e.target.files, currentPeriodId);
              e.target.value = "";
            }}
            style={{ position: "fixed", left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          />

          <input
            ref={filesInputRef}
            type="file"
            multiple
            accept={ACHAT_ACCEPTED_FILES}
            onChange={e => {
              importFiles(e.target.files, currentPeriodId);
              e.target.value = "";
            }}
            style={{ position: "fixed", left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          />

          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            style={{ ...buttonStyle, background: acc.accent, color: "#111", borderColor: acc.accent }}
          >
            <Icon as={UploadCloud} size={14} />
            Importer un dossier
          </button>

          <button
            type="button"
            onClick={() => filesInputRef.current?.click()}
            style={buttonStyle}
          >
            <Icon as={FileText} size={14} />
            Importer des factures
          </button>

          <button type="button" onClick={() => preAnalyseInvoices(currentPeriodId)} style={buttonStyle}>
            <Icon as={CheckCircle} size={14} />
            Pré-analyser
          </button>

          <button type="button" onClick={() => addInvoice(currentPeriodId)} style={buttonStyle}>
            <Icon as={Plus} size={14} />
            Ajouter une ligne
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 14px",
          borderRadius: RADIUS.md,
          background: `${acc.accent}10`,
          border: `1px solid ${acc.accent}33`,
          color: T.textSub,
          fontSize: 12.5,
          lineHeight: 1.55,
        }}
      >
        <Icon as={Info} size={14} style={{ marginTop: 2, color: acc.accent, flexShrink: 0 }} />
        <div>
          <strong style={{ color: T.text }}>Important :</strong> le mois actif est celui dans lequel les factures seront importées. Le navigateur peut créer les lignes depuis un dossier ou plusieurs fichiers, mais il ne lit pas encore le contenu des factures. Pour obtenir une vraie analyse automatique, il faudra ajouter une fonction serveur qui lit les PDF/images, extrait les champs, puis renvoie un JSON fiable avec un score de confiance.
        </div>
      </div>

      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto", maxHeight: "68vh" }}>
          <table style={{ width: "100%", minWidth: 1550, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <AchatTh T={T}>Fichier</AchatTh>
                <AchatTh T={T}>Fournisseur</AchatTh>
                <AchatTh T={T}>Typologie de charge</AchatTh>
                <AchatTh T={T}>Date</AchatTh>
                <AchatTh T={T}>N° facture</AchatTh>
                <AchatTh T={T} align="right">€ HT</AchatTh>
                <AchatTh T={T} align="right">€ TTC</AchatTh>
                <AchatTh T={T}>Contrôle</AchatTh>
                <AchatTh T={T}>Règlement</AchatTh>
                <AchatTh T={T}>Analyse</AchatTh>
                <AchatTh T={T}>Actions</AchatTh>
              </tr>
            </thead>

            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: 28, textAlign: "center", color: T.textSub, fontSize: 13 }}>
                    Aucune facture importée sur le mois “{currentPeriod.label}”. Utilise “Importer un dossier” ou “Importer des factures”.
                  </td>
                </tr>
              )}

              {invoices.map((invoice, index) => (
                <tr key={invoice.id} style={{ background: index % 2 ? T.card : T.surface }}>
                  <AchatTd T={T} width={240}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }} title={invoice.fileName}>
                        {invoice.fileName || "Saisie manuelle"}
                      </div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>
                        {formatFileSize(invoice.fileSize)}
                      </div>
                    </div>
                  </AchatTd>

                  <AchatTd T={T} width={190}>
                    <input
                      value={invoice.fournisseur ?? ""}
                      onChange={e => updateInvoice(invoice.id, "fournisseur", e.target.value, currentPeriodId)}
                      placeholder="Fournisseur"
                      style={inputStyle}
                    />
                  </AchatTd>

                  <AchatTd T={T} width={190}>
                    <select
                      value={invoice.typologie ?? ""}
                      onChange={e => updateInvoice(invoice.id, "typologie", e.target.value, currentPeriodId)}
                      style={selectStyle}
                    >
                      <option value="">À classifier</option>
                      {ACHAT_TYPOLOGIES.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </AchatTd>

                  <AchatTd T={T} width={140}>
                    <input
                      type="date"
                      value={invoice.date ?? ""}
                      onChange={e => updateInvoice(invoice.id, "date", e.target.value, currentPeriodId)}
                      style={inputStyle}
                    />
                  </AchatTd>

                  <AchatTd T={T} width={160}>
                    <input
                      value={invoice.numeroFacture ?? ""}
                      onChange={e => updateInvoice(invoice.id, "numeroFacture", e.target.value, currentPeriodId)}
                      placeholder="N° facture"
                      style={inputStyle}
                    />
                  </AchatTd>

                  <AchatTd T={T} width={130} align="right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={invoice.montantHT ?? "0"}
                      onChange={e => updateInvoice(invoice.id, "montantHT", e.target.value, currentPeriodId)}
                      style={{ ...inputStyle, textAlign: "right" }}
                    />
                  </AchatTd>

                  <AchatTd T={T} width={130} align="right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={invoice.montantTTC ?? "0"}
                      onChange={e => updateInvoice(invoice.id, "montantTTC", e.target.value, currentPeriodId)}
                      style={{ ...inputStyle, textAlign: "right" }}
                    />
                  </AchatTd>

                  <AchatTd T={T} width={170}>
                    <select
                      value={invoice.controle ?? "a_controler"}
                      onChange={e => updateInvoice(invoice.id, "controle", e.target.value, currentPeriodId)}
                      style={selectStyle}
                    >
                      {ACHAT_CONTROLES.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </AchatTd>

                  <AchatTd T={T} width={160}>
                    <select
                      value={invoice.reglement ?? "a_regler"}
                      onChange={e => updateInvoice(invoice.id, "reglement", e.target.value, currentPeriodId)}
                      style={selectStyle}
                    >
                      {ACHAT_REGLEMENTS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </AchatTd>

                  <AchatTd T={T} width={170}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11.5, color: T.textSub }}>
                        {invoice.analysisStatus === "pre_analyse_nom_fichier"
                          ? "Pré-analyse nom fichier"
                          : invoice.analysisStatus === "saisie_manuelle"
                            ? "Saisie manuelle"
                            : "Importée"}
                      </span>
                      {invoice.confidence && (
                        <span style={{ fontSize: 11, color: T.textMuted }}>
                          Confiance : {invoice.confidence} %
                        </span>
                      )}
                    </div>
                  </AchatTd>

                  <AchatTd T={T} width={90} align="center">
                    <button
                      type="button"
                      onClick={() => removeInvoice(invoice.id, currentPeriodId)}
                      title="Supprimer la facture"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        border: `1px solid ${T.border}`,
                        background: T.card,
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      <Icon as={Trash2} size={14} />
                    </button>
                  </AchatTd>
                </tr>
              ))}
            </tbody>

            {invoices.length > 0 && (
              <tfoot>
                <tr style={{ background: T.card }}>
                  <td colSpan={5} style={{ padding: "12px 10px", fontSize: 12, fontWeight: 900, color: T.textSub, textTransform: "uppercase", letterSpacing: 1 }}>
                    Total achats · {currentPeriod.label}
                  </td>
                  <td style={{ padding: "12px 10px", textAlign: "right", fontSize: 13, fontWeight: 900, color: T.text }}>
                    {fmtEur(totalHT)}
                  </td>
                  <td style={{ padding: "12px 10px", textAlign: "right", fontSize: 13, fontWeight: 900, color: T.text }}>
                    {fmtEur(totalTTC)}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function AchatTh({ T, children, align = "left" }) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        padding: "11px 10px",
        background: T.card,
        borderBottom: `1px solid ${T.border}`,
        borderRight: `1px solid ${T.border}`,
        textAlign: align,
        fontSize: 11,
        fontWeight: 900,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: T.textSub,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function AchatTd({ T, children, width, align = "left" }) {
  return (
    <td
      style={{
        width,
        padding: "8px 10px",
        borderBottom: `1px solid ${T.border}`,
        borderRight: `1px solid ${T.border}`,
        textAlign: align,
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

// ─── ONGLET EN ATTENTE DE STRUCTURATION ───────────────────────────────────────
function PlaceholderTab({ T, icon, title, description }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: RADIUS.lg,
        padding: 24,
        minHeight: 220,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: T.card,
          border: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T.text,
        }}
      >
        <Icon as={icon} size={20} />
      </div>

      <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>
        {title}
      </div>

      <div style={{ fontSize: 14, color: T.textSub, lineHeight: 1.6, maxWidth: 700 }}>
        {description}
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 8,
          marginTop: 6,
          padding: "6px 10px",
          borderRadius: RADIUS.pill,
          background: T.card,
          border: `1px solid ${T.border}`,
          color: T.textMuted,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.3,
        }}
      >
        <Icon as={Info} size={13} />
        Onglet prêt à structurer
      </div>
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ T, icon, iconColor, label, value, highlight = false }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${highlight ? iconColor + "55" : T.border}`,
        borderRadius: RADIUS.lg,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: highlight ? `0 0 0 1px ${iconColor}22` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: iconColor + "1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: iconColor,
          }}
        >
          <Icon as={icon} size={15} />
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: T.textSub,
          }}
        >
          {label}
        </div>
      </div>

      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: highlight ? iconColor : T.text,
          letterSpacing: 0.3,
        }}
      >
        {value}
      </div>
    </div>
  );
}
