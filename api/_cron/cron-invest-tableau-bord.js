// api/_cron/cron-invest-tableau-bord.js — Le tableau de bord Invest, par mail.
//
// Le problème résolu
// ──────────────────
// Le tableau de bord (onglet « Tableau de bord » d'Invest) est le seul endroit
// qui répond à « qu'est-ce que je dois faire aujourd'hui ». Il n'agissait que
// sur celui qui l'ouvrait. Personne n'ouvre une application par réflexe à 7h ;
// donc le classement le plus utile du produit ne servait que les jours où l'on
// y pensait.
//
// Ce cron le rejoue côté serveur et l'envoie. Pas un résumé : le tableau
// entier — bandeau d'état, les quatre colonnes, les priorités, le plan
// d'action, et les échéances que le tableau de bord ne montre pas.
//
// Comment il reste fidèle à l'écran
// ─────────────────────────────────
// Il n'y a pas deux logiques. Le classement vient de src/Invest/tableauBord.mjs
// — le MÊME module que Dashboard.jsx. Les tables lues viennent de la même
// liste (REQUETES_TABLEAU_BORD). Un dossier arbitré depuis le téléphone à 6h50
// n'est donc pas annoncé « à décider » à 7h.
//
// Un mail par destinataire, et pas le même
// ────────────────────────────────────────
// Le tableau de bord dépend de QUI le regarde : « délégué » veut dire « confié
// à quelqu'un d'autre que moi ». Chaque destinataire reçoit donc son propre
// classement, construit avec son identité — pas une copie du tableau de bord
// d'un autre.
//
// Contrainte de déploiement respectée
// ───────────────────────────────────
// api/_cron/ n'est pas déployé en fonctions serverless (plan Vercel Hobby =
// 12 fonctions maximum). Ce fichier n'ajoute aucune fonction : il est joignable
// par api/cron-dispatcher.js, avec un créneau GitHub Actions.
//
// Heure d'envoi
// ─────────────
// 7h Paris, avant la prise de poste — et deux heures après la veille
// d'échéances de 4h, dont les lignes sont intégrées ici. Les destinataires de
// ce mail sont pour cette raison exclus du mail de 4h
// (voir _destinataires-invest.js).

const { destinatairesTableauBord } = require("./_destinataires-invest.js");
const echeances = require("./cron-invest-echeances.js");

const ETAT_CONFIG_KEY = "invest_tableau_bord_state";
const APP_URL = "https://planning-chantiers.vercel.app";

// Gmail tronque un message au-delà d'environ 102 ko et masque la fin derrière
// un « Message tronqué ». Un tableau de bord chargé disparaîtrait donc par le
// bas, en silence — et la fin, c'est justement ce qu'on a mis en dernier parce
// que c'était le moins urgent : on croirait l'avoir lu.
//
// On ne peut pas plafonner en nombre de lignes : une carte détaillée pèse cinq
// fois une ligne de suivi, et le mail contient les deux. Le budget est donc en
// octets, dépensé dans l'ordre d'importance — à décider, puis priorités, puis
// échéances, puis le suivi. Ce qui n'entre pas est compté et annoncé.
// 70 ko d'HTML. Le seuil de Gmail porte sur le message TRANSPORTÉ, et un mail
// en français ne voyage pas à sa taille : l'encodage de transfert remplace
// chaque accent par une séquence plus longue (« é » → « =C3=A9 »). On garde donc
// une marge sous les ~102 ko à partir desquels Gmail masque la fin du message.
const BUDGET_OCTETS = 70 * 1024;

// Ce que le mail ne doit pas dépasser une fois construit, vérifié par
// scripts/verif-tableau-bord.mjs. Le budget est le levier, ceci est la garantie.
const TAILLE_MAX_OCTETS = 82 * 1024;

// Part du budget garantie à chaque section.
//
// Sans ces parts, la première section servie prenait tout : une journée à
// trente dossiers urgents laissait « Échéances & vigilances » à une seule
// ligne. Or c'est là que vivent les dates maximum de dépôt d'urbanisme, qui
// sont des délais opposables — la section la moins compressible du mail, et
// c'était celle qui disparaissait.
//
// Une section qui n'utilise pas sa part ne la prête pas aux suivantes : le mail
// est alors simplement plus court, ce qui n'a jamais posé de problème.
const PARTS = { decision: 0.40, echeances: 0.22, watch: 0.13, delegated: 0.13, done: 0.12 };

// Garde-fous en nombre de lignes, très au-dessus de l'usage normal : ils
// n'existent que pour qu'une table partie en vrille ne produise pas un mail
// absurde. En pratique, c'est le budget qui coupe.
const PLAFONDS = { decision: 60, watch: 60, delegated: 60, done: 40, echeances: 60 };

function listeBudgetee(items, rendu, budget, section) {
  const plafond = PLAFONDS[section] ?? 40;
  let quota = Math.floor(BUDGET_OCTETS * (PARTS[section] ?? 0.1));
  const morceaux = [];
  for (let i = 0; i < items.length && i < plafond; i++) {
    const bloc = rendu(items[i]);
    const cout = Buffer.byteLength(bloc);
    // Au moins une ligne quand la section a du contenu : sinon un quota épuisé
    // la rendrait indistinguable d'une section vide, ce qui est précisément le
    // mensonge qu'on cherche à éviter.
    if ((quota < cout || budget.restant < cout) && morceaux.length) break;
    quota -= cout;
    budget.restant -= cout;
    morceaux.push(bloc);
  }
  return { html: morceaux.join(""), montres: morceaux.length, caches: items.length - morceaux.length };
}

const { escapeHtml, fmtDateFr, consignerRelances, collecteurs, chargerAnnuaire } = echeances;

// Import dynamique : ce fichier est en CommonJS, le moteur du tableau de bord
// est en ESM. Même schéma qu'annuaire.mjs et relances.mjs.
let _moteur = null;
async function moteur() {
  if (!_moteur) _moteur = await import("../../src/Invest/tableauBord.mjs");
  return _moteur;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette — celle de l'écran, transposée en clair pour un client mail
// ─────────────────────────────────────────────────────────────────────────────

const NIVEAU = {
  danger:  { bord: "#dc2626", bg: "#fef2f2", texte: "#991b1b", label: "Urgent" },
  warning: { bord: "#d97706", bg: "#fffbeb", texte: "#92400e", label: "Attention" },
  info:    { bord: "#0284c7", bg: "#f0f9ff", texte: "#075985", label: "Info" },
  success: { bord: "#16a34a", bg: "#f0fdf4", texte: "#166534", label: "OK" },
};
const COLONNE_COULEUR = {
  decision:  "#dc2626",
  watch:     "#d97706",
  delegated: "#2f5fd0",
  done:      "#16a34a",
};
const TYPE_LABEL = { prospect: "Prospect", client: "Client", bien: "Bien", team: "Équipe" };

// ─────────────────────────────────────────────────────────────────────────────
// Liens profonds
//
// Les clés reconnues à l'arrivée sont celles du bootstrap de
// src/Invest/PageInvest.jsx. Une clé inventée ici ferait atterrir sur le
// tableau de bord sans ouvrir la fiche — un lien qui a l'air de marcher.
// ─────────────────────────────────────────────────────────────────────────────

function lienDossier(item) {
  const id = encodeURIComponent(String(item?.id || ""));
  if (!id) return APP_URL;
  switch (item.type) {
    case "prospect":
      return item.sourceTable === "invest_prospects"
        ? `${APP_URL}/?invest_prospect=${id}`
        : `${APP_URL}/?client_id=${id}`;
    case "client": return `${APP_URL}/?crm_client=${id}`;
    case "bien":   return `${APP_URL}/?invest_bien=${id}`;
    case "team": {
      const clientId = item.raw?.client_id;
      return clientId
        ? `${APP_URL}/?crm_client=${encodeURIComponent(clientId)}&mission_action=${id}`
        : APP_URL;
    }
    default: return APP_URL;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Briques de mise en forme
// ─────────────────────────────────────────────────────────────────────────────

function bandeauEtat(stats, doneCount) {
  const tuiles = [
    { label: "À décider",         valeur: stats.decision,     rouge: stats.decision > 0 },
    { label: "Bloqués",           valeur: stats.blocked,      rouge: stats.blocked > 0 },
    { label: "Relances retard",   valeur: stats.relancesLate, rouge: stats.relancesLate > 0 },
    { label: "Délégué",           valeur: stats.delegated,    bleu: stats.delegated > 0 },
    { label: "Traité",            valeur: doneCount,          vert: true },
  ];
  const cellules = tuiles.map(t => {
    const couleur = t.rouge ? "#dc2626" : t.bleu ? "#2f5fd0" : t.vert ? "#16a34a" : "#16a34a";
    return `<td width="20%" style="padding:4px" valign="top">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid ${couleur}44;border-radius:8px">
        <tr><td align="center" style="padding:11px 4px">
          <div style="font-size:24px;font-weight:800;color:${couleur};line-height:1.1">${t.valeur}</div>
          <div style="font-size:10.5px;font-weight:700;color:#475569;margin-top:4px;line-height:1.25">${escapeHtml(t.label)}</div>
        </td></tr>
      </table>
    </td>`;
  }).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px"><tr>${cellules}</tr></table>
    <div style="font-size:11.5px;color:#94a3b8;padding:0 4px 16px">
      Portefeuille suivi : ${stats.prospects} prospect(s) · ${stats.clients} client(s) · ${stats.biens} bien(s)
    </div>`;
}

function titreSection(texte, sousTitre, couleur, compte) {
  return `<tr><td style="padding:20px 0 10px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="border-left:4px solid ${couleur};padding:0 0 0 11px">
        <div style="font-size:15px;font-weight:800;color:#12151b">${escapeHtml(texte)}${
          compte === undefined ? "" : ` <span style="color:${couleur}">(${compte})</span>`}</div>
        ${sousTitre ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:2px">${escapeHtml(sousTitre)}</div>` : ""}
      </td>
    </tr></table>
  </td></tr>`;
}

function vide(texte) {
  return `<tr><td style="padding:0 0 8px">
    <div style="border:1px dashed #dbe1ea;border-radius:6px;padding:14px;text-align:center;color:#94a3b8;font-size:12.5px">${escapeHtml(texte)}</div>
  </td></tr>`;
}

// La carte détaillée — réservée à « à décider maintenant ». C'est la seule
// colonne où l'on doit agir : elle mérite les alertes, le responsable,
// l'échéance et l'action, comme sur l'écran.
function carteDossier(item, { safeDate }) {
  const n = NIVEAU[item.level] || NIVEAU.info;
  const alertes = (item.alerts || []).slice(0, 4).map(a => {
    const c = NIVEAU[a.level] || NIVEAU.info;
    return `<tr><td style="padding:4px 8px;font-size:12px;color:#334155;border-top:1px solid #eef2f7">${escapeHtml(a.label)}</td>`
      + `<td align="right" style="padding:4px 8px;font-size:11.5px;color:${c.bord};white-space:nowrap;border-top:1px solid #eef2f7">${a.due_date ? escapeHtml(safeDate(a.due_date)) : ""}</td></tr>`;
  }).join("");
  const restantes = Math.max(0, (item.alerts || []).length - 4);
  const lien = escapeHtml(lienDossier(item));

  return `<tr><td style="padding:0 0 8px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${n.bg};border:1px solid ${n.bord}33;border-left:3px solid ${n.bord};border-radius:0 7px 7px 0">
      <tr><td style="padding:11px 12px">
        <div style="font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;font-weight:700;color:${n.texte};margin-bottom:4px">${escapeHtml(n.label)} · ${escapeHtml(TYPE_LABEL[item.type] || item.type)}${item.readOnly ? " · lecture seule" : ""}</div>
        <div style="font-size:14.5px;font-weight:700;line-height:1.3"><a href="${lien}" style="color:#12151b;text-decoration:none">${escapeHtml(item.label)}</a></div>
        <div style="font-size:11.5px;color:#64748b;margin-top:2px">${escapeHtml(item.subtitle || "—")}</div>
        ${alertes ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:7px;background:#fff;border-radius:5px">${alertes}</table>` : ""}
        ${restantes ? `<div style="font-size:11px;color:#94a3b8;margin-top:5px">+ ${restantes} autre(s) alerte(s) sur la fiche</div>` : ""}
        <div style="font-size:11.5px;color:#64748b;margin-top:8px"><strong style="color:#475569">Resp.</strong> ${escapeHtml(item.responsable || "—")} · <strong style="color:#475569">Échéance</strong> ${escapeHtml(safeDate(item.due_date))}</div>
        <div style="font-size:11.5px;color:#64748b;margin-top:2px"><strong style="color:#475569">Action</strong> ${escapeHtml(item.next_action || "—")}</div>
        <div style="margin-top:7px"><a href="${lien}" style="font-size:12px;color:#2f5fd0;font-weight:700;text-decoration:none">Ouvrir la fiche →</a></div>
      </td></tr>
    </table>
  </td></tr>`;
}

// La ligne de suivi — pour « à surveiller », « délégué » et « traité ». Rien à
// décider là : un nom, qui le porte, pour quand. Une liste dense se lit mieux
// qu'une pile de cartes, et laisse au budget de quoi montrer plus de dossiers.
function ligneDossier(item, { safeDate }) {
  const n = NIVEAU[item.level] || NIVEAU.info;
  return `<tr>
    <td width="3" style="background:${n.bord};border-radius:2px"></td>
    <td style="padding:6px 9px;border-bottom:1px solid #eef2f7">
      <a href="${escapeHtml(lienDossier(item))}" style="font-size:13px;font-weight:700;color:#12151b;text-decoration:none">${escapeHtml(item.label)}</a>
      <div style="font-size:11px;color:#94a3b8;margin-top:1px">${escapeHtml(item.primaryAlert || item.subtitle || "—")}</div>
    </td>
    <td align="right" style="padding:6px 9px;border-bottom:1px solid #eef2f7;white-space:nowrap">
      <div style="font-size:11.5px;color:#475569">${escapeHtml(item.responsable || "—")}</div>
      <div style="font-size:11px;color:${n.bord}">${escapeHtml(safeDate(item.due_date))}</div>
    </td>
  </tr>`;
}

function colonne(items, cle, { titre, aide, budget, safeDate }) {
  const couleur = COLONNE_COULEUR[cle] || "#2f5fd0";
  const detaille = cle === "decision";
  const rendu = detaille
    ? (i) => carteDossier(i, { safeDate })
    : (i) => ligneDossier(i, { safeDate });

  const { html, caches } = listeBudgetee(items, rendu, budget, cle);
  const corps = html
    ? (detaille ? html : `<tr><td style="padding:0 0 8px"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eaf2;border-radius:7px">${html}</table></td></tr>`)
    : vide("Aucun dossier dans cette colonne.");

  return titreSection(titre, aide, couleur, items.length)
    + corps
    + (caches > 0
        ? `<tr><td style="padding:0 0 8px"><div style="font-size:12px;color:${couleur};font-weight:700">+ ${caches} dossier(s) non listé(s) ici — à voir dans le tableau de bord.</div></td></tr>`
        : "");
}

function sectionPriorites(priorites, dateLabel) {
  const remplies = (priorites || []).filter(p => p && String(p.title || "").trim());
  const corps = remplies.length
    ? remplies.map((p, i) => `<tr><td style="padding:0 0 8px">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffdf5;border:1px solid #e8d9a8;border-radius:7px">
          <tr><td style="padding:11px 12px">
            <div style="font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;font-weight:700;color:#8a6d1f;margin-bottom:4px">Priorité n°${i + 1}</div>
            <div style="font-size:14px;font-weight:700;color:#12151b">${escapeHtml(p.title)}</div>
            <div style="font-size:11.5px;color:#64748b;margin-top:3px">${escapeHtml(p.responsable || "—")} · échéance ${escapeHtml(fmtDateFr(p.due_date))}</div>
            ${p.comment ? `<div style="font-size:12px;color:#475569;margin-top:5px">${escapeHtml(p.comment)}</div>` : ""}
          </td></tr>
        </table></td></tr>`).join("")
    : vide("Aucune priorité posée. Les trois priorités du jour se saisissent dans le tableau de bord.");
  return titreSection(
    dateLabel ? `Priorités posées le ${dateLabel}` : "Priorités du jour",
    dateLabel ? "Où en sont-elles ?" : "À poser dans le tableau de bord",
    "#c9a84c") + corps;
}

function sectionEcheances(lignes, { budget }) {
  const ordre = { critique: 0, urgent: 1, a_venir: 2 };
  const couleurs = {
    critique: NIVEAU.danger, urgent: NIVEAU.warning, a_venir: NIVEAU.info,
  };
  const libelles = { critique: "En retard", urgent: "À traiter", a_venir: "À venir" };
  const triees = [...lignes].sort((a, b) =>
    (ordre[a.gravite] ?? 9) - (ordre[b.gravite] ?? 9) ||
    String(a.echeance).localeCompare(String(b.echeance)));

  const rendu = (l) => {
        const c = couleurs[l.gravite] || NIVEAU.info;
        return `<tr><td style="padding:0 0 8px">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg};border-left:3px solid ${c.bord};border-radius:0 7px 7px 0">
            <tr><td style="padding:11px 12px">
              <div style="font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;font-weight:700;color:${c.texte};margin-bottom:4px">${libelles[l.gravite] || "À venir"} · ${escapeHtml(fmtDateFr(l.echeance))}</div>
              <div style="font-size:14px;font-weight:700;color:#12151b">${escapeHtml(l.titre)}</div>
              <div style="font-size:12px;color:#475569;margin-top:2px;line-height:1.45">${escapeHtml(l.detail)}</div>
              <div style="margin-top:6px"><a href="${escapeHtml(l.lien)}" style="font-size:12px;color:#2f5fd0;font-weight:700;text-decoration:none">Ouvrir le dossier →</a></div>
            </td></tr>
          </table></td></tr>`;
  };

  const { html, caches } = listeBudgetee(triees, rendu, budget, "echeances");
  const corps = html || vide("Aucune échéance à signaler.");

  return titreSection("Échéances & vigilances", "Urbanisme, relances, états des lieux — hors tableau de bord", "#7c3aed", lignes.length)
    + corps
    + (caches > 0 ? `<tr><td style="padding:0 0 8px"><div style="font-size:12px;color:#7c3aed;font-weight:700">+ ${caches} échéance(s) non listée(s) ici.</div></td></tr>` : "");
}

function sectionPlan(plan, dateAffichee) {
  if (!plan.length) return "";
  const parResponsable = {};
  for (const p of plan) (parResponsable[p.responsable || "À définir"] ||= []).push(p);
  const corps = Object.entries(parResponsable).map(([qui, lignes]) => `
    <tr><td style="padding:0 0 8px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px">
        <tr><td style="padding:11px 12px">
          <div style="font-size:13.5px;font-weight:800;color:#12151b;margin-bottom:5px">${escapeHtml(qui)}</div>
          ${lignes.map(p => `<div style="border-top:1px solid #eef2f7;padding:6px 0">
            <div style="font-size:12.5px;font-weight:700;color:#334155">${escapeHtml(p.title || "Action")}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">Échéance ${escapeHtml(fmtDateFr(p.due_date))} · ${escapeHtml(p.source || "—")}${p.decision ? ` · ${escapeHtml(p.decision)}` : ""}</div>
          </div>`).join("")}
        </td></tr>
      </table></td></tr>`).join("");
  return titreSection(
    dateAffichee ? `Plan d'action du ${dateAffichee}` : "Plan d'action du jour",
    dateAffichee ? "Décisions rendues ce jour-là — ce qui reste à faire" : "Issu des décisions validées",
    "#0f766e", plan.length) + corps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le mail complet
// ─────────────────────────────────────────────────────────────────────────────

function buildTableauBordHtml({ prenom, dateFr, stats, colonnes, priorites, dateAffichee, lignesEcheances, plan, safeDate }) {
  const aDecider = colonnes.decision.length;
  const critique = aDecider + lignesEcheances.filter(l => l.gravite === "critique").length;

  // Le budget se dépense dans l'ordre de ce tableau — un littéral s'évalue de
  // gauche à droite. L'ordre est donc l'ordre d'importance : ce qui saute en
  // premier est ce dont on peut le mieux se passer.
  const budget = { restant: BUDGET_OCTETS };
  const corps = [
    colonne(colonnes.decision, "decision", { titre: "À décider maintenant", aide: "Dossiers qui demandent ton arbitrage aujourd'hui.", budget, safeDate }),
    sectionPriorites(priorites, dateAffichee),
    lignesEcheances.length ? sectionEcheances(lignesEcheances, { budget }) : "",
    colonne(colonnes.watch, "watch", { titre: "À surveiller", aide: "Échéance future ou point de vigilance.", budget, safeDate }),
    colonne(colonnes.delegated, "delegated", { titre: "Délégué / en attente", aide: "Confié à l'équipe ou en attente d'un retour.", budget, safeDate }),
    colonnes.done.length
      ? colonne(colonnes.done, "done", { titre: dateAffichee ? `Traité le ${dateAffichee}` : "Traité aujourd'hui", aide: "Dossiers sortis du flux.", budget, safeDate })
      : "",
    sectionPlan(plan, dateAffichee),
  ].join("");

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#12151b;background:#ffffff">
    <div style="background:#12151b;padding:22px 24px;border-bottom:3px solid #4070e8">
      <div style="color:#7ba4f7;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Invest · Tableau de bord</div>
      <div style="color:#ffffff;font-size:20px;font-weight:800">${prenom ? `${escapeHtml(prenom)}, ` : ""}${aDecider} dossier${aDecider > 1 ? "s" : ""} à décider</div>
      <div style="color:#94a3b8;font-size:13px;margin-top:4px">${escapeHtml(dateFr)}${critique ? ` · ${critique} point(s) urgent(s)` : " · rien d'urgent"}</div>
    </div>
    <div style="border:1px solid #e0e4ef;border-top:none;padding:18px 20px 4px">
      ${bandeauEtat(stats, colonnes.done.length)}
      <table width="100%" cellpadding="0" cellspacing="0">${corps}</table>
      <div style="text-align:center;padding:22px 0 18px">
        <a href="${APP_URL}" style="background:#4070e8;color:#ffffff;font-weight:800;text-decoration:none;padding:12px 26px;border-radius:8px;display:inline-block;font-size:14px">Ouvrir le tableau de bord →</a>
      </div>
      <p style="margin:0 0 16px;font-size:11.5px;color:#94a3b8;line-height:1.55;border-top:1px solid #e2e8f0;padding-top:14px">
        Envoi automatique chaque matin, du lundi au vendredi. Ce mail est le tableau de bord
        tel qu'il s'affiche pour toi : un dossier arbitré dans l'application en disparaît de
        lui-même. Une journée chargée dépasse ce qu'un mail peut porter : le titre de chaque
        section donne le nombre réel, et ce qui n'est pas listé est compté juste en dessous.
      </p>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routine de la dernière journée travaillée
//
// À 7h, la routine du JOUR est vide : rien n'a encore été arbitré. Afficher
// « Traité aujourd'hui : 0 » et « aucune priorité » chaque matin n'apprendrait
// rien. On remonte donc la dernière journée qui a laissé une trace : ses
// priorités (sont-elles faites ?) et ce qui en est sorti.
// ─────────────────────────────────────────────────────────────────────────────

async function routineDerniereJournee(supabase, jour) {
  const { data, error } = await supabase
    .from("invest_morning_routine_items")
    .select("*")
    .lt("routine_date", jour)
    .order("routine_date", { ascending: false })
    .limit(300);

  if (error) {
    console.warn("[invest-tableau-bord] routine précédente:", error.message);
    return { lignes: [], date: null };
  }
  const derniere = (data || [])[0]?.routine_date || null;
  if (!derniere) return { lignes: [], date: null };
  return { lignes: (data || []).filter(l => l.routine_date === derniere), date: derniere };
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée, appelé par le dispatcher
// ─────────────────────────────────────────────────────────────────────────────

async function runInvestTableauBord(req, supabase, t, envoyerMail) {
  const jour = t.dateIso;
  const resume = { destinataires: 0, envoyes: [], echecs: [], deja_envoye: [], avertissements: [] };

  // Sans clé de service, les policies « bureau uniquement » renvoient zéro
  // ligne : le mail conclurait à tort qu'il n'y a rien à faire aujourd'hui.
  // C'est le pire résultat possible — un tableau de bord vide rassure.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    resume.avertissements.push(
      "SUPABASE_SERVICE_ROLE_KEY absente : les tables Invest sont sous RLS, " +
      "le tableau de bord risque d'être vide sans que cela se voie.");
  }

  const cibles = await destinatairesTableauBord(supabase);
  resume.destinataires = cibles.length;
  if (!cibles.length) {
    resume.avertissements.push(
      "Aucun destinataire : régler planning_config.invest_tableau_bord_destinataires " +
      "{ emails: [...] }, ou donner le rôle admin/direction à un utilisateur Invest actif.");
    return resume;
  }

  // Idempotence : même forme que les autres crons ({ date, emails }). Le
  // dispatcher tolère une dérive horaire, donc un double déclenchement est
  // possible ; sans cette garde le même tableau de bord partirait deux fois.
  const { data: etatRow } = await supabase.from("planning_config")
    .select("value").eq("key", ETAT_CONFIG_KEY).maybeSingle();
  const etat = etatRow?.value || {};
  const dejaTraites = new Set(etat.date === jour ? (etat.emails || []) : []);
  const aTraiter = cibles.filter(c => {
    if (dejaTraites.has(c.email)) { resume.deja_envoye.push(c.email); return false; }
    return true;
  });
  if (!aTraiter.length) return resume;

  const { chargerTableauBord, consolidateData, repartirEnColonnes, routineDepuisLignes, planFromRoutine, safeDate } = await moteur();

  // Les données du tableau de bord, lues UNE fois pour tous les destinataires :
  // seul le classement dépend de qui regarde, pas les lignes.
  const donnees = await chargerTableauBord(supabase, {
    jour,
    onErreur: (label, err, requis) => {
      const msg = `${label} : ${err?.message || err}`;
      console.warn("[invest-tableau-bord]", msg);
      if (requis) resume.avertissements.push(`Table indispensable illisible — ${msg}`);
    },
  });

  const routineJour = routineDepuisLignes(donnees.routineRows);
  const veille = await routineDerniereJournee(supabase, jour);
  const routineVeille = routineDepuisLignes(veille.lignes);

  // Les échéances hors tableau de bord (urbanisme, relances, états des lieux,
  // notifications en échec) : mêmes collecteurs que la veille de 4h.
  const annuaire = await chargerAnnuaire(supabase);
  const paquets = await Promise.all([
    collecteurs.urbanisme(supabase, annuaire, jour),
    collecteurs.relances(supabase, annuaire, jour),
    collecteurs.edl(supabase, annuaire, jour),
    collecteurs.notifications(supabase, jour),
  ]);
  const toutesEcheances = paquets.flat();

  for (const cible of aTraiter) {
    const profil = { nom: cible.nom, email: cible.email };
    const pilote = cible.nom || String(cible.email || "").split("@")[0] || "";

    const data = consolidateData({ ...donnees, jour, profil, pilote });

    // Les trois colonnes vivantes se calculent sur la routine DU JOUR : seul un
    // arbitrage rendu aujourd'hui doit faire sortir un dossier du flux.
    const colonnes = repartirEnColonnes({ dossiers: data.allDossiers, routine: routineJour, filtre: "all" });

    // Le bilan, lui, se lit sur la dernière journée qui a laissé une trace. À
    // 7h la journée du jour est vierge par construction : afficher « traité : 0,
    // aucune priorité » chaque matin n'apprendrait rien. On montre donc la
    // veille, datée — sauf si quelqu'un a déjà arbitré ce matin.
    const journeeEnCours = Object.keys(routineJour.decisions).length > 0
      || routineJour.priorities.some(p => p && String(p.title || "").trim());
    const routineAffichee = journeeEnCours ? routineJour : routineVeille;
    const dateAffichee = journeeEnCours ? null : (veille.date ? fmtDateFr(veille.date) : null);

    // On ne recopie PAS le « traité » de la veille dans les colonnes du jour :
    // un dossier arbitré hier et non clos est de nouveau dans le flux, il
    // apparaîtrait donc deux fois — en « délégué » et en « traité hier ». Le
    // bilan de la veille passe par ses priorités et son plan d'action, qui
    // disent la même chose sous une forme actionnable.
    const priorites = routineAffichee.priorities;
    const plan = planFromRoutine(routineAffichee, data.allDossiers);

    // Ses lignes à lui : celles dont il est responsable, plus celles que
    // personne ne porte (qui vont aux administrateurs, comme à 4h).
    const sesEcheances = toutesEcheances.filter(l =>
      l.destinataire
        ? String(l.destinataire).toLowerCase() === cible.email
        : annuaire.admins.map(a => String(a).toLowerCase()).includes(cible.email));

    const html = buildTableauBordHtml({
      prenom: String(cible.nom || "").split(/\s+/)[0],
      dateFr: t.dateFr,
      stats: data.stats,
      colonnes,
      priorites,
      dateAffichee,
      lignesEcheances: sesEcheances,
      plan,
      safeDate,
    });

    const aDecider = colonnes.decision.length;
    const enRetard = sesEcheances.filter(l => l.gravite === "critique").length;
    const sujet = aDecider || enRetard
      ? `[Invest] ${aDecider} dossier(s) à décider${enRetard ? ` · ${enRetard} échéance(s) dépassée(s)` : ""} — ${t.dateFr}`
      : `[Invest] Tableau de bord du ${t.dateFr} — rien à arbitrer`;

    try {
      const r = await envoyerMail(req, cible.email, sujet, html);
      if (r.ok) {
        resume.envoyes.push({ to: cible.email, a_decider: aDecider, surveiller: colonnes.watch.length, delegue: colonnes.delegated.length, echeances: sesEcheances.length });
        dejaTraites.add(cible.email);
        // Les relances qui viennent de partir sont consignées, sinon la même
        // repart demain au même palier. Règle partagée avec la veille de 4h.
        await consignerRelances(supabase, sesEcheances, resume);
      } else {
        resume.echecs.push({ to: cible.email, status: r.status, data: r.data });
      }
    } catch (e) {
      resume.echecs.push({ to: cible.email, error: e.message });
    }
  }

  // On ne mémorise que les envois réussis : un échec doit pouvoir repartir au
  // déclenchement suivant plutôt que d'être considéré comme traité.
  if (resume.envoyes.length) {
    await supabase.from("planning_config").upsert(
      { key: ETAT_CONFIG_KEY, value: { date: jour, emails: Array.from(dejaTraites) } },
      { onConflict: "key" }
    );
  }

  return resume;
}

module.exports = { runInvestTableauBord };
// Exportés pour être éprouvés sans base ni réseau (scripts/verif-tableau-bord.mjs).
module.exports.buildTableauBordHtml = buildTableauBordHtml;
module.exports.lienDossier = lienDossier;
module.exports.routineDerniereJournee = routineDerniereJournee;
module.exports.PLAFONDS = PLAFONDS;
module.exports.BUDGET_OCTETS = BUDGET_OCTETS;
module.exports.TAILLE_MAX_OCTETS = TAILLE_MAX_OCTETS;
module.exports.PARTS = PARTS;
module.exports.ETAT_CONFIG_KEY = ETAT_CONFIG_KEY;
