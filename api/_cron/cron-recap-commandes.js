// api/cron-recap-commandes.js — Mail récap "à commander ce vendredi"
//
// Destiné aux admin + conducteurs : reçoivent chaque vendredi matin un récap
// avec (1) les matériaux à commander pour la semaine prochaine et (2) les
// demandes ouvriers en attente (table besoins, statut = "en_attente").
//
// (1) Depuis la tâche 15 du projet docs/projets/organisation-par-jour.md
// (décision de Loris du 24/11/2026, « corrige aussi le mail ») : MÊMES
// articles que l'onglet « Semaine prochaine » de la page « Commandes à
// passer » (fenêtre « Commandes de la semaine ») et que le bloc du jour
// « Matériaux à commander » :
//   - mêmes lectures que la page (src/Renovation/commandesAPasserLecture.mjs,
//     partagé avec le navigateur, client service passé en paramètre) ;
//   - même liste (modeleCommandesAPasser + lignesACommander,
//     commandesAPasserV1.mjs) ;
//   - même rangement par semaine et même présentation
//     (partieMailMateriauxACommanderV1, commandesParSemaineV1.mjs), avec la
//     date du jour À PARIS (t.dateIso) passée explicitement : le serveur
//     tourne en UTC.
// L'ancien calcul (materiauxACommanderV1.mjs, matériaux prévisionnels de
// phasages.plan_travaux) n'avait plus de données : la partie annonçait
// toujours « Aucun matériau prévisionnel à commander aujourd'hui ». Si la
// lecture échoue, la partie le dit (jamais « aucun »).
//
// Variables d'environnement requises (déjà configurées) :
//   CRON_SECRET, VITE_SUPABASE_URL, VITE_SUPABASE_KEY, RESEND_KEY / RESEND_FROM
//
// Idempotence : 1 mail max par jour (clé planning_config.recap_commandes_state).

const { createClient } = require("@supabase/supabase-js");
const { enTetesAppelServeur, verifierAppelServeur } = require("../_lib/autorisationServeur");

function parisNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const weekday = parts.weekday.charAt(0).toUpperCase() + parts.weekday.slice(1).toLowerCase();
  return {
    weekday,
    dateFr:  `${parts.day}/${parts.month}/${parts.year}`,
    dateIso: `${parts.year}-${parts.month}-${parts.day}`,
    hour:    parseInt(parts.hour, 10),
    minute:  parseInt(parts.minute, 10),
  };
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

async function envoyerMail(req, to, subject, html) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers.host;
  const url   = `${proto}://${host}/api/send-email`;
  // /api/send-email refuse les envois anonymes : on s'y présente comme serveur.
  const resp = await fetch(url, {
    method: "POST",
    headers: enTetesAppelServeur("cron:recap-commandes"),
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// Date « 2026-11-30 » → « 30/11/2026 » (dateBesoinFR, comme le bloc du jour).
// Partie « Matériaux à commander · semaine prochaine » : `materiaux` est le
// résultat de partieMailMateriauxACommanderV1 (commandesParSemaineV1.mjs).
function sectionMateriauxHtml(materiaux, dateBesoinFR) {
  const encadre = (texte, couleur = "#5b6a8a", fond = "#f6f8fc") => `
    <div style="padding:14px 18px;background:${fond};border-radius:8px;color:${couleur};font-size:13px;text-align:center">
      ${escapeHtml(texte)}
    </div>
  `;
  if (materiaux.etat === "erreur") {
    return encadre(materiaux.message || "Les articles à commander n'ont pas pu être lus.", "#b42318", "#fdecec");
  }
  if (materiaux.etat !== "liste") {
    return encadre(materiaux.message || "Aucun matériau à commander pour la semaine prochaine.");
  }
  const th = (txt, extra = "") => `<th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase${extra}">${txt}</th>`;
  return `
    <div style="font-size:12px;color:#5b6a8a;margin-bottom:10px">
      Articles de la page Commandes à passer dont la date de besoin tombe la semaine prochaine (onglet « Semaine prochaine » du bouton « Commandes de la semaine ») · date de besoin = date prévue la plus proche des tâches de l'ouvrage.
    </div>
    <div style="font-size:15px;font-weight:800;color:#1a1f2e;margin-bottom:10px">${escapeHtml(materiaux.total)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
      <thead><tr style="background:#f6f8fc">${th("Par chantier")}${th("Articles", ";text-align:center;width:80px")}${th("Date de besoin", ";width:150px")}</tr></thead>
      <tbody>
        ${materiaux.chantiers.map(c => `
          <tr style="border-bottom:1px solid #f0f3f8">
            <td style="padding:6px 10px;color:#1a1f2e;font-weight:700;border-left:4px solid ${escapeHtml(c.couleur || "#FFC200")}">${escapeHtml(c.nom)}</td>
            <td style="padding:6px 10px;color:#1a1f2e;text-align:center">${c.nb}</td>
            <td style="padding:6px 10px;color:#5b6a8a">dès le ${escapeHtml(dateBesoinFR(c.dateBesoin))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f6f8fc">${th("Article")}${th("Qté", ";text-align:center;width:80px")}${th("Ouvrage")}${th("Chantier", ";width:130px")}${th("Date de besoin", ";width:100px")}</tr></thead>
      <tbody>
        ${materiaux.articles.map(m => `
          <tr style="border-bottom:1px solid #f0f3f8">
            <td style="padding:6px 10px;color:#1a1f2e">${escapeHtml(m.libelle)}</td>
            <td style="padding:6px 10px;color:#5b6a8a;text-align:center">${escapeHtml(m.quantite || "—")}</td>
            <td style="padding:6px 10px;color:#5b6a8a">${escapeHtml(m.ouvrage || "—")}</td>
            <td style="padding:6px 10px;color:#5b6a8a">${escapeHtml(m.chantier || "—")}</td>
            <td style="padding:6px 10px;color:#5b6a8a;white-space:nowrap">${escapeHtml(dateBesoinFR(m.dateBesoin))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${materiaux.texteAutres ? `<div style="font-size:12px;color:#5b6a8a;margin-top:8px">${escapeHtml(materiaux.texteAutres)}.</div>` : ""}
  `;
}

// En-tête : nombre d'articles de la partie matériaux (ou « lecture
// impossible », jamais 0 à la place d'une donnée illisible).
function resumeMateriaux(materiaux) {
  if (materiaux.etat === "erreur") return "matériaux de la semaine prochaine : lecture impossible";
  const n = materiaux.nbArticles || 0;
  return `${n} article${n > 1 ? "s" : ""} à commander la semaine prochaine`;
}

// Construit le HTML du mail récap.
function buildRecapHtml({ dateFr, materiaux, dateBesoinFR, demandesOuvriers, baseUrl }) {
  const nbDemandes     = demandesOuvriers.length;

  const sectionCommandes = sectionMateriauxHtml(materiaux, dateBesoinFR);

  const sectionDemandes = demandesOuvriers.length === 0 ? `
    <div style="padding:14px 18px;background:#f6f8fc;border-radius:8px;color:#5b6a8a;font-size:13px;font-style:italic;text-align:center">
      Aucune demande ouvrier en attente.
    </div>
  ` : `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f6f8fc">
          <th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase">Article</th>
          <th style="padding:8px 10px;text-align:center;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:80px">Qté</th>
          <th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:120px">Demandé par</th>
          <th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:120px">Chantier</th>
        </tr>
      </thead>
      <tbody>
        ${demandesOuvriers.map(d => `
          <tr style="border-bottom:1px solid #f0f3f8">
            <td style="padding:7px 10px;color:#1a1f2e">
              <div style="font-weight:600">${escapeHtml(d.article || "(sans libellé)")}</div>
              ${d.notes ? `<div style="font-size:11px;color:#5b6a8a;margin-top:2px">${escapeHtml(d.notes)}</div>` : ""}
            </td>
            <td style="padding:7px 10px;color:#5b6a8a;text-align:center">${escapeHtml(d.quantite || "—")}</td>
            <td style="padding:7px 10px;color:#5b6a8a">${escapeHtml(d.ouvrier_demandeur || "—")}</td>
            <td style="padding:7px 10px;color:#5b6a8a">${escapeHtml(d.chantier_nom || "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  return `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Récap commandes</div>
      <div style="color:#fff;font-size:20px;font-weight:800">🛒 À commander aujourd'hui — ${escapeHtml(dateFr)}</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px">
        ${escapeHtml(resumeMateriaux(materiaux))}
        ${nbDemandes > 0 ? ` · ${nbDemandes} demande${nbDemandes > 1 ? "s" : ""} ouvrier${nbDemandes > 1 ? "s" : ""}` : ""}
      </div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">

      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#5b6a8a;margin-bottom:10px">
        📦 ${escapeHtml(materiaux.titre)}
      </div>
      ${sectionCommandes}

      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#5b6a8a;margin:24px 0 10px">
        👷 Demandes des ouvriers en attente
      </div>
      ${sectionDemandes}

      <div style="text-align:center;margin:24px 0 0">
        <a href="${escapeHtml(baseUrl)}#planning-commandes"
           style="background:#FFC200;color:#1a1f2e;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;display:inline-block;font-size:14px">
          Ouvrir le Planning des commandes →
        </a>
      </div>

      <p style="margin:18px 0 0;font-size:11px;color:#999;text-align:center">
        Vous recevez ce récap car vous êtes administrateur ou conducteur de travaux sur Profero Planning.
      </p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;
}

// Lectures et calcul de la page « Commandes à passer » : modules partagés
// avec le navigateur, chargés à la demande comme les autres modules .mjs
// appelés depuis api/_cron/.
let _modulesCommandes = null;
async function modulesCommandes() {
  if (!_modulesCommandes) {
    const [L, C, W] = await Promise.all([
      import("../../src/Renovation/commandesAPasserLecture.mjs"),
      import("../../src/Renovation/commandesAPasserV1.mjs"),
      import("../../src/Renovation/commandesParSemaineV1.mjs"),
    ]);
    _modulesCommandes = { L, C, W };
  }
  return _modulesCommandes;
}

/**
 * Partie « Matériaux à commander · semaine prochaine » : articles de l'onglet
 * « Semaine prochaine » de la page, pour la date de Paris `dateIso`.
 * Mêmes lectures (commandesAPasserLecture.mjs), même liste et même appel que
 * le bloc du jour (BlocMateriauxACommander.jsx). Une lecture en échec donne
 * une partie « erreur », jamais « aucun ».
 */
async function partieMateriauxSemaineProchaine(supabase, dateIso) {
  const { L, C, W } = await modulesCommandes();
  let lignes = null;
  let erreur = null;
  try {
    const [v, ch] = await Promise.all([L.lireDonneesCommandesAPasser(supabase), L.lireChantiersCommandesAvec(supabase)]);
    erreur = v.erreur || ch.erreur;
    if (!erreur) {
      lignes = C.lignesACommander(C.modeleCommandesAPasser({
        phasages: v.phasages, chantiers: ch.chantiers, matById: C.indexMateriaux(v.materiaux), lotById: C.indexLots(v.lots),
        lignesCmd: v.lignesCmd, lots: v.lots, achatsParCh: v.achatsParCh,
      }));
    }
  } catch (e) {
    erreur = e?.message || String(e) || "lecture impossible";
  }
  return { partie: W.partieMailMateriauxACommanderV1({ dateIso, erreur, lignes }), dateBesoinFR: W.dateBesoinFR };
}

// ─── LOGIQUE MÉTIER (réutilisable par le dispatcher) ─────────────────────────
async function runRecapCommandes(req, supabase, t) {
  // 1) Idempotence : skip si déjà envoyé aujourd'hui
  const { data: stateRow } = await supabase.from("planning_config")
    .select("value").eq("key", "recap_commandes_state").maybeSingle();
  if (stateRow?.value?.date === t.dateFr) {
    return { skipped: "already_sent_today", date: t.dateFr };
  }

  // 2) Charger config (chantiers) + demandes + utilisateurs, et la partie
  //    matériaux (lectures de la page Commandes à passer, date de Paris).
  const [materiauxQ, cfgQ, demandesQ, usersQ] = await Promise.all([
    partieMateriauxSemaineProchaine(supabase, t.dateIso),
    supabase.from("planning_config").select("key,value").in("key", ["chantiers"]),
    supabase.from("besoins")
      .select("id, article, quantite, ouvrier_demandeur, notes, chantier_id")
      .eq("statut", "en_attente"),
    supabase.from("utilisateurs")
      .select("id, email, nom, role, actif")
      .eq("actif", true)
      .in("role", ["admin", "conducteur"]),
  ]);

  const { partie: materiaux, dateBesoinFR } = materiauxQ;
  const cfg = {}; (cfgQ.data || []).forEach(r => { cfg[r.key] = r.value; });
  const chantiers   = Array.isArray(cfg.chantiers) ? cfg.chantiers : [];
  const chantById   = chantiers.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
  const demandes    = demandesQ.data || [];
  // Exclut les comptes sans email (adresse synthétique @profero.local, non routable).
  const dests       = (usersQ.data || []).map(u => u.email)
    .filter(e => e && !String(e).toLowerCase().endsWith("@profero.local"));

  // 3) Matériaux à commander la semaine prochaine : calculés en 2)
  //    (partieMateriauxSemaineProchaine), comme la page et le bloc du jour.
  const nbMateriaux = materiaux.etat === "liste" ? materiaux.nbArticles : 0;

  // 4) Enrichir les demandes ouvriers avec chantier_nom (besoins.chantier_id direct)
  const demandesEnrichies = demandes.map(d => ({
    ...d,
    chantier_nom: chantById[d.chantier_id]?.nom || "—",
  }));

  // 5) Si rien à signaler ET aucune demande → ne rien envoyer (évite spam).
  //    Une lecture des matériaux en échec n'est PAS « rien à signaler » : le
  //    mail part et le dit.
  if (materiaux.etat === "aucun" && demandesEnrichies.length === 0) {
    await supabase.from("planning_config").upsert(
      { key: "recap_commandes_state", value: { date: t.dateFr, sent_to: [], items: 0, skipped: "empty" } },
      { onConflict: "key" }
    );
    return { skipped: "no_content", date: t.dateFr };
  }

  // 6) Aucun destinataire ? On note mais on ne tente pas l'envoi
  if (dests.length === 0) {
    return { skipped: "no_recipients", date: t.dateFr, materiaux_semaine_prochaine: nbMateriaux, materiaux_etat: materiaux.etat, demandes: demandesEnrichies.length };
  }

  // 7) Envoi (un seul mail à plusieurs destinataires)
  const baseUrl = process.env.APP_BASE_URL || "https://planning-chantiers.vercel.app";
  const html = buildRecapHtml({
    dateFr:           t.dateFr,
    materiaux,
    dateBesoinFR,
    demandesOuvriers: demandesEnrichies,
    baseUrl,
  });
  const subject = `🛒 Profero Planning · Récap commandes du ${t.dateFr}`;
  const r = await envoyerMail(req, dests, subject, html);

  // 8) Marquer envoyé (idempotence) si OK
  if (r.ok) {
    await supabase.from("planning_config").upsert(
      { key: "recap_commandes_state", value: { date: t.dateFr, sent_to: dests, items: nbMateriaux + demandesEnrichies.length } },
      { onConflict: "key" }
    );
  }

  return {
    date: t.dateFr,
    sent: r.ok,
    status: r.status,
    error: r.ok ? null : (r.data?.error || `HTTP ${r.status}`),
    destinataires: dests.length,
    materiaux_semaine_prochaine: nbMateriaux,
    materiaux_etat: materiaux.etat,
    ...(materiaux.etat === "erreur" ? { materiaux_erreur: materiaux.message } : {}),
    demandes_ouvriers: demandesEnrichies.length,
  };
}

module.exports = async function handler(req, res) {
  // Auth — fermée par défaut (handler non déployé : api/_cron/ n'est pas
  // exposé, mais la règle reste la même partout).
  const acces = verifierAppelServeur(req);
  if (!acces.ok) return res.status(acces.status).json({ error: acces.error });

  const t = parisNow();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  try {
    const summary = await runRecapCommandes(req, supabase, t);
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("cron-recap-commandes error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};

module.exports.runRecapCommandes = runRecapCommandes;
module.exports.parisNow = parisNow;
module.exports.partieMateriauxSemaineProchaine = partieMateriauxSemaineProchaine;
module.exports.buildRecapHtml = buildRecapHtml;
