import React, { useMemo } from "react";
import { Icon } from "../ui";
import { FONT, RADIUS, SPACING } from "../constants";
import { THEMES_INV, SU, WA, DA, fmtDashboardEur } from "./_shared";
import {
  UserPlus,
  Search,
  Phone,
  Calendar,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

const PROSPECTION_STAGES = [
  {
    id: "nouveau",
    label: "Nouveaux prospects",
    description: "Prospects ajoutés mais pas encore qualifiés",
    icon: UserPlus,
    color: "#60A5FA",
  },
  {
    id: "qualification",
    label: "À qualifier",
    description: "Analyse du profil, budget, objectif et délai",
    icon: Search,
    color: "#C9A84C",
  },
  {
    id: "contact",
    label: "Contact / relance",
    description: "Premier échange réalisé ou relance à prévoir",
    icon: Phone,
    color: "#F59E0B",
  },
  {
    id: "rdv",
    label: "RDV planifié",
    description: "Rendez-vous découverte ou closing prévu",
    icon: Calendar,
    color: "#8B5CF6",
  },
  {
    id: "proposition",
    label: "Proposition envoyée",
    description: "Offre commerciale ou contrat transmis",
    icon: FileText,
    color: "#10B981",
  },
  {
    id: "signe",
    label: "Signés",
    description: "Prospects à convertir en clients",
    icon: CheckCircle2,
    color: SU,
  },
  {
    id: "perdu",
    label: "Perdus / sommeil",
    description: "Prospects non transformés ou à reprendre plus tard",
    icon: XCircle,
    color: DA,
  },
];

const PREVIEW_KPIS = [
  { label: "Prospects actifs", value: "—", icon: UserPlus, color: "#60A5FA" },
  { label: "RDV à venir", value: "—", icon: Calendar, color: "#8B5CF6" },
  { label: "Relances en retard", value: "—", icon: Clock, color: WA },
  { label: "CA potentiel", value: fmtDashboardEur(0), icon: TrendingUp, color: SU },
];

function EmptyStageCard({ stage, T }) {
  const IconStage = stage.icon;

  return (
    <div
      className="inv-card"
      style={{
        padding: 14,
        minHeight: 154,
        borderTop: `3px solid ${stage.color}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: RADIUS.md,
              background: `${stage.color}18`,
              color: stage.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon as={IconStage} size={16} strokeWidth={2.2} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: FONT.sm.size + 1,
                fontWeight: 900,
                color: T.text,
                lineHeight: 1.15,
              }}
            >
              {stage.label}
            </div>
            <div
              style={{
                fontSize: FONT.xs.size + 1,
                color: T.textMuted,
                marginTop: 2,
              }}
            >
              0 prospect
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: FONT.xs.size + 1,
            color: T.textSub,
            lineHeight: 1.45,
          }}
        >
          {stage.description}
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: `1px solid ${T.border}`,
          fontSize: FONT.xs.size + 1,
          color: T.textMuted,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>Pipeline prêt</span>
        <Icon as={ArrowRight} size={13} />
      </div>
    </div>
  );
}

function PreviewKpiCard({ item, T }) {
  const KpiIcon = item.icon;

  return (
    <div
      className="inv-card"
      style={{
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: RADIUS.lg,
          background: `${item.color}18`,
          color: item.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon as={KpiIcon} size={18} strokeWidth={2.1} />
      </div>

      <div>
        <div
          style={{
            fontSize: FONT.xs.size,
            color: T.textMuted,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            fontWeight: 800,
            marginBottom: 2,
          }}
        >
          {item.label}
        </div>
        <div
          style={{
            fontSize: FONT.lg.size,
            color: T.text,
            fontWeight: 900,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {item.value}
        </div>
      </div>
    </div>
  );
}

export default function Prospection({ profil, T = THEMES_INV.dark }) {
  const stages = useMemo(() => PROSPECTION_STAGES, []);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1440, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: T.text,
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            CRM Prospection
          </div>
          <div
            style={{
              fontSize: 14,
              color: T.textSub,
              maxWidth: 760,
              lineHeight: 1.5,
            }}
          >
            Suivi des prospects avant signature. Cette page est indépendante du
            CRM Client et servira ensuite à qualifier, relancer, signer puis
            convertir les prospects en clients.
          </div>
        </div>

        <button
          className="inv-btn inv-btn-blue"
          type="button"
          onClick={() =>
            alert(
              "La création de prospect sera ajoutée à l'étape suivante avec la table Supabase invest_prospects."
            )
          }
        >
          <Icon as={UserPlus} size={15} />
          Nouveau prospect
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {PREVIEW_KPIS.map((item) => (
          <PreviewKpiCard key={item.label} item={item} T={T} />
        ))}
      </div>

      <div
        className="inv-card"
        style={{
          padding: 18,
          marginBottom: 22,
          background: T.card,
        }}
      >
        <div
          style={{
            fontSize: FONT.md.size + 1,
            fontWeight: 900,
            color: T.text,
            marginBottom: 6,
          }}
        >
          Objectif de cette page
        </div>

        <div
          style={{
            fontSize: FONT.sm.size,
            color: T.textSub,
            lineHeight: 1.6,
          }}
        >
          La page Prospection va devenir le point d’entrée commercial de
          Profero Invest. Elle doit contenir les prospects avant signature, avec
          leurs informations, leur niveau de qualification, leurs relances,
          leurs rendez-vous, leurs propositions commerciales et un bouton de
          conversion vers le CRM Client une fois le contrat signé.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(180px, 1fr))",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {stages.map((stage) => (
          <EmptyStageCard key={stage.id} stage={stage} T={T} />
        ))}
      </div>

      <div
        style={{
          marginTop: 24,
          padding: 16,
          borderRadius: RADIUS.lg,
          background: T.cardHover,
          border: `1px solid ${T.border}`,
          color: T.textSub,
          fontSize: FONT.sm.size,
          lineHeight: 1.55,
        }}
      >
        <strong style={{ color: T.text }}>Étape suivante :</strong> création de
        la table Supabase <code>invest_prospects</code>, puis ajout des fonctions
        d’ajout, modification, suppression logique, pipeline, historique des
        actions et conversion vers <code>invest_clients</code>.
      </div>
    </div>
  );
}
