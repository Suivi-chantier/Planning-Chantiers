-- =====================================================================
-- ESPACE OUVRIER — Plusieurs responsables par équipe
-- =====================================================================
-- À appliquer manuellement dans le SQL Editor Supabase (copier-coller).
-- (create or replace : ré-exécutable sans rien casser.)
-- Prérequis : sql/202609_responsable_planning.sql (norm_prenom, policies).
--
-- Une équipe peut maintenant porter PLUSIEURS chefs (ex. Venceslas ET
-- Steven sur « Réseaux Électrique » / « Réseaux Plomberie »). Le modèle
-- de planning_config/equipes gagne un champ optionnel :
--   responsables : ["Venceslas", "Steven"]   (tableau de prénoms-planning)
-- L'ancien champ `responsable` (string) est CONSERVÉ pour compatibilité
-- (semis Point 1, PhasageV2, resource_ids…) et vaut le premier de la
-- liste. Les deux fonctions ci-dessous matchent l'UNION des deux champs :
-- une équipe jamais rééditée dans l'Admin continue de fonctionner.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 — est_responsable() : vrai si le prénom-planning de l'appelant figure
-- dans `responsables[]` OU dans `responsable` d'au moins une équipe.
-- Toujours fail-closed (clé absente, items/responsables malformés,
-- prénom NULL → false, jamais d'erreur).
-- ---------------------------------------------------------------------

create or replace function public.est_responsable()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.planning_config pc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(pc.value->'items') = 'array'
             then pc.value->'items' else '[]'::jsonb end
      ) e
      cross join lateral (
        select jsonb_array_elements_text(
          case when jsonb_typeof(e->'responsables') = 'array'
               then e->'responsables' else '[]'::jsonb end
        ) as prenom
        union
        select e->>'responsable'
      ) resp
      where pc.key = 'equipes'
        and public.norm_prenom(resp.prenom) <> ''
        and public.norm_prenom(resp.prenom)
            = public.norm_prenom(public.mon_prenom_planning())
    ),
    false
  );
$$;

revoke all on function public.est_responsable() from public;
revoke all on function public.est_responsable() from anon;
grant execute on function public.est_responsable() to authenticated;


-- ---------------------------------------------------------------------
-- 2 — mon_profil_espace() : même union responsables[]/responsable pour
-- lister les équipes dont l'appelant est (co-)responsable.
-- ---------------------------------------------------------------------

create or replace function public.mon_profil_espace()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'role',            public.mon_role(),
    'prenom_planning', public.mon_prenom_planning(),
    'est_responsable', public.est_responsable(),
    'equipes_responsable', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',      e->>'id',
        'nom',     e->>'nom',
        'couleur', e->>'couleur'
      ))
      from public.planning_config pc
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(pc.value->'items') = 'array'
             then pc.value->'items' else '[]'::jsonb end
      ) e
      where pc.key = 'equipes'
        and exists (
          select 1
          from (
            select jsonb_array_elements_text(
              case when jsonb_typeof(e->'responsables') = 'array'
                   then e->'responsables' else '[]'::jsonb end
            ) as prenom
            union
            select e->>'responsable'
          ) resp
          where public.norm_prenom(resp.prenom) <> ''
            and public.norm_prenom(resp.prenom)
                = public.norm_prenom(public.mon_prenom_planning())
        )
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.mon_profil_espace() from public;
revoke all on function public.mon_profil_espace() from anon;
grant execute on function public.mon_profil_espace() to authenticated;


-- =====================================================================
-- REQUÊTE DE CONTRÔLE (lecture seule, à exécuter après la migration)
-- =====================================================================
-- Tous les chefs reconnus, équipe par équipe (union des deux champs) :
-- select e->>'nom' as equipe, public.norm_prenom(resp.prenom) as chef
-- from public.planning_config pc
-- cross join lateral jsonb_array_elements(pc.value->'items') e
-- cross join lateral (
--   select jsonb_array_elements_text(
--     case when jsonb_typeof(e->'responsables') = 'array'
--          then e->'responsables' else '[]'::jsonb end) as prenom
--   union select e->>'responsable'
-- ) resp
-- where pc.key = 'equipes' and public.norm_prenom(resp.prenom) <> ''
-- order by equipe, chef;
