-- Correction de déploiement : garantir le mode d'exécution de la fonction.
alter function public.comptabiliser_couts_facture(uuid) security definer;
