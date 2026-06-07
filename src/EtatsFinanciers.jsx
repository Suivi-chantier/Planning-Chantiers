import React, { useState, useEffect, useCallback } from "react";
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

function createId(prefix = "item") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function emptyMonths() {
  return MOIS.reduce((acc, m) => ({ ...acc, [m.id]: { fg: "", heures: "" } }), {});
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
    acompteMois: "",
    acomptePrecedent: "",
    note: "",
    sourceRow: 9999,
    lockedFields: {},
    inheritedFromPeriodId: "",
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
    row.values[periodId] = emptyAvancementValue();
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
    note: "",
    sourceRow: previousValue?.sourceRow ?? 9999,
    inheritedFromPeriodId: previousPeriodId,
    lockedFields: createLockedFields(),
  };
}

function isAvancementFieldLocked(values, field) {
  return Boolean(values?.lockedFields?.[field]);
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
              sourceRow: value?.sourceRow ?? 9999,
              lockedFields: value?.lockedFields ?? {},
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
  const [months, setMonths] = useState(emptyMonths());
  const [avancement, setAvancement] = useState(() => normalizeAvancement());
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
          value: { months, avancement },
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
        const nextLocks = {
          ...currentLocks,
          [field]: !currentLocks[field],
        };

        return {
          ...row,
          values: {
            ...row.values,
            [periodId]: {
              ...currentValue,
              lockedFields: nextLocks,
            },
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
              ...emptyAvancementValue(),
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
          padding: activeTab === "avancement_chantier" ? "24px 20px" : "24px 32px",
          maxWidth: activeTab === "avancement_chantier" ? "none" : 1220,
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
            updateRow={updateAvancementRow}
            updateValue={updateAvancementValue}
            toggleLock={toggleAvancementLock}
          />
        )}

        {activeTab === "achat" && (
          <PlaceholderTab
            T={T}
            icon={Euro}
            title="Achat"
            description="Cet onglet servira à suivre les achats liés aux chantiers : fournisseurs, matériaux, montants engagés, factures reçues, factures payées, reste à payer et écarts avec les budgets prévus."
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
  updateRow,
  updateValue,
  toggleLock,
}) {
  const periods = avancement.periods || [];
  const rows = avancement.rows || [];
  const activePeriod = periods.find(period => period.id === activePeriodId) || periods[0];
  const currentPeriodId = activePeriod?.id;

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
      // Colonnes automatisées comme dans le fichier Excel :
      // H = avancement réel - % facturé
      // I = montant total HT × % à provisionner
      const pctProvisionner = avancementReel - pctFacture;
      const caProvisionner = montantHT * pctProvisionner;

      return {
        row,
        values,
        hasPeriodData,
        montantHT,
        avancementReel,
        pctFacture,
        pctProvisionner,
        caProvisionner,
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
              À la création d'un nouveau mois, les chantiers du mois précédent sont repris automatiquement. Les lignes à 100 % d'avancement sont classées en bas.
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
            Colonnes calculées automatiquement
          </span>
          <span>Survole les en-têtes ou les cellules calculées pour lire les formules. Clique sur un cadenas pour modifier une valeur reprise.</span>
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
          <table className="ef-avancement-table" style={{ width: "100%", minWidth: 2020, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
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
                  <td colSpan={13} style={{ padding: "28px 12px", textAlign: "center", color: T.textSub, fontSize: 14 }}>
                    Aucun chantier saisi pour ce mois. Clique sur <strong style={{ color: T.text }}>Ajouter un chantier</strong> pour commencer.
                  </td>
                </tr>
              )}

              {computedRows.map(({ row, values, montantHT, avancementReel, pctFacture, pctProvisionner, caProvisionner, isCompleted }) => (
                <tr
                  key={row.id}
                  className="ef-row"
                  title={isCompleted ? "Chantier terminé à 100 % : classé automatiquement en bas de tableau" : undefined}
                  style={{
                    borderBottom: `1px solid ${T.border}`,
                    opacity: isCompleted ? 0.72 : 1,
                  }}
                >
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

                  <td style={{ padding: "7px 8px", width: 120 }}>
                    <div
                      title={`Formule : ${fmtPct(avancementReel)} - ${fmtPct(pctFacture)} = ${fmtPct(pctProvisionner)}`}
                      style={{
                        ...calculatedCell,
                        color: pctProvisionner >= 0 ? acc.accent : "#ff5c5c",
                      }}
                    >
                      {fmtPct(pctProvisionner)}
                    </div>
                  </td>

                  <td style={{ padding: "7px 8px", width: 150 }}>
                    <div
                      title={`Formule : ${fmtEur(montantHT)} × ${fmtPct(pctProvisionner)} = ${fmtEur(caProvisionner)}`}
                      style={{
                        ...calculatedCell,
                        minWidth: 130,
                        color: caProvisionner >= 0 ? T.text : "#ff5c5c",
                      }}
                    >
                      {fmtEur(caProvisionner)}
                    </div>
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
              ))}
            </tbody>

            <tfoot>
              <tr style={{ background: T.card }}>
                <td colSpan={2} style={{ padding: "12px", fontSize: 12, fontWeight: 800, color: T.textSub, textTransform: "uppercase", letterSpacing: 1 }}>
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
          Le <strong style={{ color: T.text }}>% à provisionner</strong> est automatique : <em>avancement réel - % facturé</em>. Le <strong style={{ color: T.text }}>CA HT à provisionner</strong> est calculé automatiquement : <em>montant HT × % à provisionner</em>. Lorsqu'un nouveau mois est créé, les chantiers du mois précédent sont repris, l'avancement précédent reprend l'avancement réel du mois précédent, et les valeurs héritées peuvent être modifiées en cliquant sur le cadenas.
        </div>
      </div>
    </>
  );
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
