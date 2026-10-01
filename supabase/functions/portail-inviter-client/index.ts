// Edge Function : portail-inviter-client (Portail client Invest, étape 5).
// Invite (ou renvoie le lien à) le client d'une fiche : crée son compte de connexion,
// le relie au client, puis lui envoie un courriel en français avec un lien à usage
// unique vers /espace-client. Réservé aux administrateurs et aux commerciaux.
//
// L'ORDRE EST LA SÉCURITÉ :
//   1. POST seulement ; jeton valide (auth.getUser)
//   2. droit : RPC portail_gestionnaire() AVEC le jeton de l'appelant (admin/commercial actif)
//   3. SEULEMENT ICI le service_role : adresse prise sur la fiche CLIENT (jamais dans la
//      requête), refus si c'est celle d'un collaborateur, décision sur le compte existant
//   4. le lien client <-> compte est écrit AVANT l'envoi du courriel (le hook d'accès
//      refuserait sinon le jeton à l'ouverture du lien)
//   5. courriel via la messagerie Profero (Apps Script) ; le lien n'est ni journalisé ni renvoyé
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adresseInvitable, decisionCompte, estUuid, lienPortail, construireCourriel } from "./invitation.mjs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corps: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const SITE = (Deno.env.get("PORTAIL_SITE_URL") || "https://planning-chantiers.vercel.app").replace(/\/+$/, "");
const EXPEDITEUR = "og@groupe-profero.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);

  // 1. Jeton
  const authorization = req.headers.get("Authorization") || "";
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ ok: false, error: "Connexion requise." }, 401);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const clePublique = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const scriptUrl = Deno.env.get("GOOGLE_APPS_SCRIPT_WEBAPP_URL") || "";
  const scriptSecret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") || "";
  if (!url || !clePublique || !cleService || !scriptUrl || !scriptSecret) return json({ ok: false, error: "Configuration serveur incomplète." }, 500);

  const sbUtilisateur = createClient(url, clePublique, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: eAuth } = await sbUtilisateur.auth.getUser(m[1]);
  if (eAuth || !u?.user) return json({ ok: false, error: "Connexion requise." }, 401);

  // 2. Droit : administrateur ou commercial actif
  const { data: gestionnaire, error: eDroit } = await sbUtilisateur.rpc("portail_gestionnaire");
  if (eDroit || gestionnaire !== true) return json({ ok: false, error: "Réservé aux administrateurs et aux commerciaux." }, 403);

  let clientId = "";
  try { clientId = String((await req.json())?.clientId || ""); } catch { /* corps invalide */ }
  if (!estUuid(clientId)) return json({ ok: false, error: "Client invalide." }, 400);

  // 3. Seulement maintenant : le service_role
  const admin = createClient(url, cleService, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: client } = await admin.from("invest_clients").select("id, prenom, nom, email").eq("id", clientId).maybeSingle();
  if (!client) return json({ ok: false, error: "Client introuvable." }, 404);
  const adresse = adresseInvitable(client.email);
  if (!adresse.ok) return json({ ok: false, error: adresse.motif }, 422);
  const email = adresse.email;

  const { data: collab } = await admin.from("utilisateurs").select("id").ilike("email", email).limit(1);
  if (collab?.length) return json({ ok: false, error: "Cette adresse est celle d'un collaborateur Profero : elle ne peut pas servir à un compte client." }, 409);

  // Compte de connexion : création (invitation) ou compte déjà existant (lien de réinitialisation)
  let compte: { id: string; last_sign_in_at?: string | null } | null = null;
  let nouveau: { id: string } | null = null;
  let jeton = "";
  let type: "invite" | "recovery" = "invite";
  const inv = await admin.auth.admin.generateLink({ type: "invite", email });
  if (!inv.error && inv.data?.user) {
    nouveau = inv.data.user; // créé à l'instant : décision « creer »
    jeton = inv.data.properties?.hashed_token || "";
  } else if (/already|exists|registered/i.test(`${inv.error?.code || ""} ${inv.error?.message || ""}`)) {
    const rec = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (rec.error || !rec.data?.user) return json({ ok: false, error: "Impossible de préparer le lien pour le moment." }, 502);
    compte = rec.data.user; jeton = rec.data.properties?.hashed_token || ""; type = "recovery";
  } else {
    return json({ ok: false, error: "Impossible de créer le compte pour le moment." }, 502);
  }
  const compteId = (compte?.id ?? nouveau?.id) as string;
  const { data: lien } = await admin.from("invest_portail_comptes").select("client_id, statut").eq("auth_user_id", compteId).maybeSingle();
  const decision = compte ? decisionCompte({ compte, lienExistant: lien, clientId }) : { action: "creer" };
  if (decision.action === "refuser") return json({ ok: false, error: decision.motif }, 409);
  if (!jeton) return json({ ok: false, error: "Impossible de préparer le lien pour le moment." }, 502);

  // 4. Lien client <-> compte AVANT le courriel
  const par = u.user.email || null;
  const { error: eLien } = lien
    ? await admin.from("invest_portail_comptes").update({ statut: "actif", revoque_par: null, revoque_le: null }).eq("auth_user_id", compteId)
    : await admin.from("invest_portail_comptes").insert({ client_id: clientId, auth_user_id: compteId, statut: "actif", invite_par: par });
  if (eLien) {
    if (decision.action === "creer") await admin.auth.admin.deleteUser(compteId); // pas de compte orphelin
    return json({ ok: false, error: "Impossible d'enregistrer l'accès pour le moment." }, 500);
  }

  // 5. Courriel
  const renvoi = decision.action === "renvoyer" || type === "recovery";
  const courriel = construireCourriel({ prenom: client.prenom, nom: client.nom, lien: lienPortail(SITE, jeton, type), renvoi });
  let envoye = false;
  try {
    const rep = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: scriptSecret, mode: "email", to: email, subject: courriel.sujet, body: courriel.texte, htmlBody: courriel.html,
        responsable: "", client: [client.prenom, client.nom].filter(Boolean).join(" "), source: "profero-invest",
        sourceEmail: EXPEDITEUR, senderEmail: EXPEDITEUR, actionId: "portail-invitation", clientId,
      }),
      redirect: "follow",
    });
    const brut = await rep.text();
    let j: Record<string, unknown> = {};
    try { j = brut ? JSON.parse(brut) : {}; } catch { j = { ok: false }; }
    envoye = rep.ok && j.ok !== false;
  } catch { envoye = false; }
  if (!envoye) return json({ ok: false, error: "L'accès est prêt mais le courriel n'a pas pu partir. Réessayez dans un instant.", accesPret: true }, 502);

  return json({ ok: true, renvoi, envoyeA: email });
});
