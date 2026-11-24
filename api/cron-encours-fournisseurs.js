// api/cron-encours-fournisseurs.js — Mail hebdo "Encours fournisseurs"
//
// Envoyé le vendredi (après-midi, via le workflow GitHub) à certains
// utilisateurs : récap des montants à payer par fournisseur et par mois
// d'échéance, avec le comparatif saisi vs facturé.
//
// Depuis le 24/11/2026 (projet docs/projets/organisation-par-jour.md, tâche
// 14, décision de Loris) : MÊME SERVICE que la page Encours fournisseurs.
//   - Lectures : src/Renovation/encoursFournisseursLecture.mjs, les requêtes
//     de la page (mêmes tables, colonnes, filtres, limites), avec le client
//     du serveur.
//   - Calcul : src/Renovation/encoursFournisseursPageV1.mjs (via
//     encoursFournisseursMailV2.mjs), celui de la page et du bloc du jour.
//   - Chiffre annoncé : « À payer · <mois en cours> », la première carte de
//     la page ; le mois en cours est celui de la date de Paris (le serveur
//     tourne en UTC). Le détail garde sa forme : les 6 mois d'échéance les
//     plus récents de la page, avec leurs montants.
//   - Lecture en échec : rien n'est envoyé, la route répond 500 (jamais un
//     montant calculé sur des données incomplètes).
// L'ancien calcul (src/Renovation/encoursFournisseursV1.mjs, total « 6
// derniers mois ») n'est plus appelé ici.
//
// Destinataires : planning_config.encours_mail_destinataires (liste d'emails)
// si renseignée ; sinon repli sur les utilisateurs actifs admin + comptable.
//
// Idempotence : 1 envoi max par jour (planning_config.encours_mail_state).
//
// Notification F2 (projet docs/projets/notifications-push.md, tâche 8) : après
// le mail, un push court « Encours fournisseurs : X € HT à payer · <mois> »
// vers la page de l'encours, tiré du MÊME contenu que le mail.
// `?simulation=1` : calcule le contenu du mail et du push, sans mail ni push.

const { createClient } = require("@supabase/supabase-js");
const { verifierAppelServeur, enTetesAppelServeur } = require("./_lib/autorisationServeur");

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Lectures et calcul de la page Encours fournisseurs (tâche 14 du projet
// organisation-par-jour) ; contenu de la notification F2.
let _encours = null;
async function moduleEncours() {
  if (!_encours) {
    const [lecture, mail, direction] = await Promise.all([
      import("../src/Renovation/encoursFournisseursLecture.mjs"),
      import("../src/Renovation/encoursFournisseursMailV2.mjs"),
      import("../src/Renovation/notificationsDirectionV1.mjs"),
    ]);
    _encours = {
      lireDonneesEncoursFournisseurs: lecture.lireDonneesEncoursFournisseurs,
      encoursDuMailV2: mail.encoursDuMailV2,
      eur: mail.eurMail,
      contenuPushF2V2: direction.contenuPushF2V2,
    };
  }
  return _encours;
}

async function envoyerMail(req, to, subject, html) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/api/send-email`;
  // /api/send-email refuse les envois anonymes : on s'y présente comme serveur.
  const resp = await fetch(url, {
    method: "POST",
    headers: enTetesAppelServeur("cron:encours-fournisseurs"),
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// ─── LOGIQUE MÉTIER (réutilisable par le dispatcher) ─────────────────────────
async function runEncoursFournisseurs(req, supabase, t) {
  const simulation = ["1", "true", "oui"].includes(String(req?.query?.simulation || "").toLowerCase());
  // 1) Idempotence : 1 envoi max par jour
  const { data: stateRow } = await supabase.from("planning_config")
    .select("value").eq("key", "encours_mail_state").maybeSingle();
  if (!simulation && stateRow?.value?.date === t.dateFr) {
    return { skipped: "already_sent_today", date: t.dateFr };
  }

  // 2) Données : les lectures de la page Encours fournisseurs ; calcul de la
  //    page, mois en cours = mois de la date de Paris.
  const E = await moduleEncours();
  const { eur } = E;
  const donnees = await E.lireDonneesEncoursFournisseurs(supabase);
  if (donnees.erreur) {
    // Une impossibilité reste visible : pas de mail ni de push avec un montant faux.
    throw new Error(`Encours fournisseurs illisible (${donnees.erreur}) : ni mail ni notification envoyés.`);
  }
  const moisCourant = String(t.dateIso || "").slice(0, 7);
  const encours = E.encoursDuMailV2({ donnees, moisCourant });
  const { mois } = encours;
  const ceMois = encours.moisCourant;

  // Simulation (?simulation=1) : ni mail, ni push, ni état écrit.
  if (simulation) {
    return { simulation: true, date: t.dateFr, mois_courant: ceMois.cle, a_payer_mois_courant: ceMois.aPayer,
      paye_mois_courant: ceMois.paye, mois: mois.length,
      detail_mois: mois.map(g => ({ mois: g.mois, a_payer: g.aPayer, paye: g.paye, fournisseurs: g.fourns.length })),
      notification_f2: E.contenuPushF2V2({ encours, dateParis: t.dateIso }) };
  }

  if (encours.nbMoisPage === 0) {
    await supabase.from("planning_config").upsert({ key: "encours_mail_state", value: { date: t.dateFr, skipped: "empty" } }, { onConflict: "key" });
    return { skipped: "no_content", date: t.dateFr };
  }

  // 3) Destinataires
  const { data: destCfg } = await supabase.from("planning_config").select("value").eq("key", "encours_mail_destinataires").maybeSingle();
  let dests = Array.isArray(destCfg?.value) ? destCfg.value
    : (Array.isArray(destCfg?.value?.emails) ? destCfg.value.emails : []);
  // Les comptes sans email portent une adresse synthétique @profero.local, non routable.
  const routable = (e) => e && !String(e).toLowerCase().endsWith("@profero.local");
  dests = dests.filter(routable);
  if (dests.length === 0) {
    const { data: users } = await supabase.from("utilisateurs").select("email, role, actif").eq("actif", true).in("role", ["admin", "comptable"]);
    dests = (users || []).map(u => u.email).filter(routable);
  }
  if (dests.length === 0) {
    return { skipped: "no_recipients", date: t.dateFr, push_f2: await envoyerPushF2(E, encours, t) };
  }

  // 4) HTML
  const baseUrl = process.env.APP_BASE_URL || "https://planning-chantiers.vercel.app";
  const sections = mois.map(g => {
    const rows = g.fourns.map(pf => {
      const aP = pf.aPayer;
      const ecart = (pf.facture > 0 && pf.saisi > 0) ? (pf.facture - pf.saisi) : null;
      const ecartTxt = ecart != null ? `${ecart > 0 ? "+" : ""}${eur(ecart)} €` : "—";
      const ecartColor = ecart == null ? "#999" : (Math.abs(ecart) < 1 ? "#22c55e" : "#f5a623");
      return `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8">${escapeHtml(pf.nom)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace">${pf.saisi > 0 ? eur(pf.saisi) + " €" : ""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace">${pf.facture > 0 ? eur(pf.facture) + " €" : ""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace;color:${ecartColor}">${ecartTxt}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace;font-weight:700;color:#e6ae00">${aP > 0 ? eur(aP) + " €" : (pf.paye > 0 ? "payé" : "")}</td>
      </tr>`;
    }).join("");
    return `<div style="margin-top:18px">
      <div style="font-size:13px;font-weight:800;color:#1a1f2e;text-transform:capitalize;border-bottom:2px solid #1a1f2e;padding-bottom:4px;margin-bottom:6px">
        ${escapeHtml(g.libelle)} — <span style="color:#e6ae00">${eur(g.aPayer)} € à payer</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f6f8fc">
          <th style="padding:6px 8px;text-align:left;color:#5b6a8a;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Fournisseur</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">Saisi</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">Facturé</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">Écart</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">À payer</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");

  const html = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Encours fournisseurs</div>
      <div style="color:#fff;font-size:20px;font-weight:800">💰 Encours fournisseurs — ${escapeHtml(t.dateFr)}</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px">À payer · ${escapeHtml(ceMois.libelle)} : <strong style="color:#FFC200">${eur(ceMois.aPayer)} € HT</strong></div>
      <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:2px">Payé comptant · ${escapeHtml(ceMois.libelle)} : ${eur(ceMois.paye)} € HT</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px">
      ${sections}
      <div style="text-align:center;margin:22px 0 0">
        <a href="${escapeHtml(baseUrl)}#encours-fournisseurs" style="background:#FFC200;color:#1a1f2e;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;display:inline-block;font-size:14px">Ouvrir l'encours fournisseurs →</a>
      </div>
      <p style="margin:18px 0 0;font-size:11px;color:#999;text-align:center">${escapeHtml(encours.explication)}, comme la page Encours fournisseurs (${mois.length} mois d'échéance les plus récents sur ${encours.nbMoisPage}). « Saisi » = vos commandes ; « Facturé » = factures reçues ; « Écart » = facturé − saisi.</p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;

  const subject = `💰 Profero Planning · Encours fournisseurs du ${t.dateFr}`;
  const r = await envoyerMail(req, dests, subject, html);

  if (r.ok) {
    await supabase.from("planning_config").upsert(
      { key: "encours_mail_state", value: { date: t.dateFr, sent_to: dests, mois_courant: ceMois.cle, a_payer_mois_courant: ceMois.aPayer } },
      { onConflict: "key" }
    );
  }
  // 5) Push F2 (projet notifications-push, tâche 8), APRÈS le mail : même
  //    chiffre, quel que soit le résultat du mail (les destinataires sont
  //    réglés à part, dans Réglages › Notifications).
  const push_f2 = await envoyerPushF2(E, encours, t);
  return {
    date: t.dateFr, sent: r.ok, status: r.status,
    error: r.ok ? null : (r.data?.error || `HTTP ${r.status}`),
    destinataires: dests.length, mois: mois.length,
    mois_courant: ceMois.cle, a_payer_mois_courant: ceMois.aPayer,
    push_f2,
  };
}

// Notification F2 : un push court qui renvoie vers la page de l'encours. Un
// échec n'empêche jamais le mail (clé « erreur », pas « error »). Rejouer le
// même jour ne crée aucun doublon (clé de regroupement F2-<date de Paris>).
async function envoyerPushF2(E, encours, t) {
  const n = E.contenuPushF2V2({ encours, dateParis: t.dateIso });
  if (!n) return { notifications: 0 };
  try {
    const { appelerSendPush } = require("./_cron/cron-push-reportes.js");
    const r = await appelerSendPush({ mode: "serveur", ...n });
    return { notifications: 1, titre: n.titre, ecrites_en_boite: r?.ecrites_en_boite || 0, envoyes: r?.envoyes || 0,
      echecs: r?.echecs || 0, bloque_par: r?.resume?.bloque_par || null };
  } catch (e) {
    return { notifications: 0, erreur: e.message };
  }
}

// Handler direct (test manuel : /api/cron-encours-fournisseurs)
module.exports = async function handler(req, res) {
  // Auth — fermée par défaut : sans CRON_SECRET configuré, la route refuse
  // (500) au lieu de s'ouvrir. Voir api/_lib/autorisationServeur.js.
  const acces = verifierAppelServeur(req);
  if (!acces.ok) return res.status(acces.status).json({ error: acces.error });
  const { parisNow } = require("./_cron/cron-recap-commandes.js");
  const t = parisNow();
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) return res.status(500).json({ error: "Supabase env vars missing" });
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  try {
    const summary = await runEncoursFournisseurs(req, supabase, t);
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("cron-encours-fournisseurs error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};

module.exports.runEncoursFournisseurs = runEncoursFournisseurs;
