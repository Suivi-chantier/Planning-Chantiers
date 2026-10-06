// Edge Function : portail-depot-document (Portail client Invest, dépôt de pièces).
// Le client dépose un document (PDF, JPG, PNG, 10 Mo) que Profero lui a demandé, ou un autre document.
// Le fichier n'est jamais lu par Profero avant vérification : il arrive « à vérifier ».
//
// DEUX TEMPS (le fichier ne transite pas par la fonction) :
//   action "preparer"  : contrôle la demande, enregistre le dépôt « en attente du fichier » et renvoie une
//                        adresse de dépôt à usage unique vers un chemin choisi PAR LE SERVEUR.
//   action "confirmer" : relit le fichier déposé, vérifie sa taille et ses premiers octets ; s'il n'est pas
//                        conforme il est SUPPRIMÉ ; sinon le dépôt passe « à vérifier ».
//
// L'ORDRE EST LA SÉCURITÉ :
//   1. OPTIONS / méthode POST seulement
//   2. jeton présent et valide (auth.getUser)
//   3. le client est celui de la connexion (portail_client_id() appelée avec le jeton de l'appelant) ;
//      jamais un identifiant lu dans le corps de la requête
//   4. les pièces demandées viennent de la base (portail_pieces_demandees() avec le jeton), pas du client
//   5. SEULEMENT ICI le service_role écrit (dépôt, adresse de dépôt, suppression d'un fichier refusé)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validerDemande, cheminDepot, estUuid, signatureValide, extension, TAILLE_MAX, DEPOTS_EN_COURS_MAX } from "./regles.mjs";

const BUCKET = "invest-documents";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corps: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ ok: false, error: "Connexion requise." }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const clePublique = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !clePublique || !cleService) return json({ ok: false, error: "Configuration serveur incomplète." }, 500);

  const sbUtilisateur = createClient(url, clePublique, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: eAuth } = await sbUtilisateur.auth.getUser(m[1]);
  if (eAuth || !u?.user) return json({ ok: false, error: "Connexion requise." }, 401);

  // 3. Le client de la connexion.
  const { data: clientId, error: eClient } = await sbUtilisateur.rpc("portail_client_id");
  if (eClient || !clientId) return json({ ok: false, error: "Accès non autorisé." }, 403);

  let corps: Record<string, unknown> = {};
  try { corps = await req.json(); } catch { return json({ ok: false, error: "Requête invalide." }, 400); }
  const action = String(corps?.action || "");
  const sbService = createClient(url, cleService, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "preparer") {
    // 4. Les pièces demandées, d'après la base.
    const { data: pieces } = await sbUtilisateur.rpc("portail_pieces_demandees");
    const demandees = Array.isArray(pieces) ? pieces : [];
    const hier = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: enAttente } = await sbService.from("invest_portail_depots").select("id", { count: "exact", head: true })
      .eq("client_id", clientId).or(`statut.eq.a_verifier,and(statut.eq.en_attente_fichier,cree_le.gt.${hier})`);
    const v = validerDemande({
      nomFichier: String(corps.nomFichier || ""), taille: corps.taille, mime: String(corps.mime || ""),
      pieceCle: corps.pieceCle ? String(corps.pieceCle) : null, libelle: String(corps.libelle || ""),
      piecesDemandees: demandees, depotsEnCours: enAttente ?? 0,
    });
    if (!v.ok) return json({ ok: false, error: v.motif }, 400);

    const depotId = crypto.randomUUID();
    const chemin = cheminDepot(clientId, depotId, v.nomSur);
    const { error: eIns } = await sbService.from("invest_portail_depots").insert({
      id: depotId, client_id: clientId, piece_cle: v.pieceCle, libelle: v.libelle, nom_fichier: String(corps.nomFichier).slice(0, 200),
      chemin, mime: String(corps.mime).toLowerCase(), taille: v.taille, statut: "en_attente_fichier",
    });
    if (eIns) return json({ ok: false, error: "Dépôt impossible pour le moment." }, 500);
    const { data: signe, error: eSign } = await sbService.storage.from(BUCKET).createSignedUploadUrl(chemin);
    if (eSign || !signe?.token) {
      await sbService.from("invest_portail_depots").update({ statut: "annule", motif: "Adresse de dépôt non créée" }).eq("id", depotId);
      return json({ ok: false, error: "Dépôt impossible pour le moment." }, 500);
    }
    return json({ ok: true, depotId, chemin: signe.path ?? chemin, token: signe.token, tailleMax: TAILLE_MAX, depotsMax: DEPOTS_EN_COURS_MAX });
  }

  if (action === "confirmer") {
    const depotId = String(corps.depotId || "");
    if (!estUuid(depotId)) return json({ ok: false, error: "Dépôt invalide." }, 400);
    const { data: depot } = await sbService.from("invest_portail_depots").select("id, chemin, nom_fichier, statut")
      .eq("id", depotId).eq("client_id", clientId).eq("statut", "en_attente_fichier").maybeSingle();
    if (!depot) return json({ ok: false, error: "Dépôt introuvable." }, 404);

    const { data: fichier, error: eDl } = await sbService.storage.from(BUCKET).download(depot.chemin);
    if (eDl || !fichier) return json({ ok: false, error: "Le fichier n'est pas arrivé. Réessayez." }, 404);
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const ext = extension(depot.nom_fichier);
    if (octets.length === 0 || octets.length > TAILLE_MAX || !signatureValide(octets.slice(0, 16), ext)) {
      await sbService.storage.from(BUCKET).remove([depot.chemin]);          // jamais gardé : ce n'est pas le type annoncé
      await sbService.from("invest_portail_depots").update({ statut: "annule", motif: "Fichier non conforme au type annoncé ou trop volumineux" }).eq("id", depot.id);
      return json({ ok: false, error: "Ce fichier n'est pas un document valide (PDF, JPG ou PNG de 10 Mo au plus)." }, 422);
    }
    const { error: eMaj } = await sbService.from("invest_portail_depots")
      .update({ statut: "a_verifier", taille: octets.length, depose_le: new Date().toISOString() }).eq("id", depot.id).eq("statut", "en_attente_fichier");
    if (eMaj) return json({ ok: false, error: "Dépôt impossible pour le moment." }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Action inconnue." }, 400);
});
