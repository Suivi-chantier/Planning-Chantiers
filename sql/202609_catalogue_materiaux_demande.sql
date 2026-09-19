-- =====================================================================
-- CATALOGUE MATÉRIAUX ÉPURÉ — RPC publique pour les demandes de besoin
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- Idempotent : create or replace function.
--
-- TEMPS 1 SUR 2 — MIGRATION ADDITIVE, À APPLIQUER EN PREMIER.
-- Elle ne ferme rien : elle CRÉE le remplaçant. La fermeture de la table
-- est dans sql/202609_materiaux_bibliotheque_fermeture.sql, qui ne doit
-- être appliquée qu'APRÈS le déploiement du frontend qui appelle cette
-- RPC. Inverser l'ordre casserait l'onglet Commande de l'espace ouvrier
-- et le formulaire public /rapport.
--
-- POURQUOI CETTE RPC EXISTE
-- -------------------------
-- public.materiaux_bibliotheque mélange un CATALOGUE (nom, référence,
-- catégorie, photo, unité) et des données commerciales internes :
-- prix_unitaire, fournisseur, fournisseur_id, lien_fournisseur, notes,
-- stock_min. Deux écrans ont pourtant besoin du catalogue :
--   - OuvrierCommande.jsx      → onglet « Commande » de l'espace ouvrier ;
--   - BesoinCommandeDrawer.jsx → tiroir « besoin de commande », affiché
--     AUSSI dans le formulaire public /rapport, donc SANS authentification.
-- Les deux faisaient un select("*") sur la table, ce qui exposait les prix
-- fournisseurs à n'importe quel visiteur anonyme (565 lignes).
--
-- Vérifié avant écriture : ni l'un ni l'autre n'affiche de prix. Les seuls
-- champs consommés sont id, nom, reference, categorie, photo_url. `unite`
-- est ajoutée ici pour les usages à venir (afficher « 2 sacs », « 3 m² »)
-- sans avoir à rouvrir quoi que ce soit plus tard.
--
-- LA RÈGLE À TENIR
-- ----------------
-- ⚠ NE JAMAIS ROUVRIR public.materiaux_bibliotheque EN DIRECT À `anon`
--   NI AUX OUVRIERS, sous aucune forme — ni policy de lecture « juste
--   pour dépanner », ni vue sans filtre de colonnes, ni repli côté front.
--   La RLS s'applique aux LIGNES, jamais aux COLONNES : ouvrir la table,
--   c'est ouvrir les prix. Le seul chemin autorisé pour le terrain et le
--   public est cette RPC, dont la liste de colonnes est écrite en dur
--   ci-dessous — un `select *` ici rouvrirait la fuite en silence.
--
-- SECURITY DEFINER assumé : le corps s'exécute avec les droits du
-- propriétaire, donc il traverse la RLS de la table. C'est précisément
-- l'effet recherché — la fonction devient le seul guichet, et elle ne peut
-- renvoyer que six colonnes. Aucune garde d'appelant n'est posée : le
-- formulaire /rapport est volontairement accessible sans connexion, et ce
-- catalogue ne contient rien de confidentiel.
--
-- PÉRIMÈTRE
-- ---------
-- - Ne touche AUCUNE policy, AUCUN grant de table, AUCUNE donnée.
-- - N'ajoute aucun droit d'écriture : la fonction est en lecture seule.
-- - EXECUTE accordé explicitement à anon et authenticated uniquement,
--   après révocation de l'exécution implicite de PUBLIC.
-- =====================================================================

begin;

create or replace function public.catalogue_materiaux_demande()
returns table (
  id        uuid,
  nom       text,
  reference text,
  categorie text,
  photo_url text,
  unite     text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Colonnes listées une à une, JAMAIS `select *` : c'est cette liste qui
  -- tient la promesse « aucun prix, aucun fournisseur ». Sont volontairement
  -- absentes : prix_unitaire, fournisseur, fournisseur_id, lien_fournisseur,
  -- stock_min, notes, created_at.
  select m.id, m.nom, m.reference, m.categorie, m.photo_url, m.unite
  from public.materiaux_bibliotheque m
  -- Tri par nom, comme le faisait le .order("nom") des deux écrans. L'id
  -- départage les homonymes : sans lui, deux matériaux de même nom
  -- pourraient permuter d'un appel à l'autre.
  order by m.nom, m.id;
$$;

-- Droits d'exécution : explicites, pas hérités.
revoke all on function public.catalogue_materiaux_demande() from public;
grant execute on function public.catalogue_materiaux_demande() to anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (lecture seule, transaction annulée)
-- =====================================================================
-- Attendu : le même catalogue pour les cinq profils (anon, ouvrier actif,
-- bureau actif, profil absent, profil inactif), et exactement six colonnes.
--
-- begin;
--   set local role anon;
--   select count(*) from public.catalogue_materiaux_demande();
-- rollback;
--
-- Colonnes réellement renvoyées (doit valoir exactement
-- « id, nom, reference, categorie, photo_url, unite ») :
--   select string_agg(p.name, ', ' order by p.ord)
--   from information_schema.routines r
--   cross join lateral unnest(...) -- ou : select * from catalogue_materiaux_demande() limit 1;
-- =====================================================================
