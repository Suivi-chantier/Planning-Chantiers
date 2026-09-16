// src/Renovation/TauxHorairesVenteAdmin.jsx — Réglages → Taux horaires →
// « Taux horaires de main-d'œuvre » : instance de l'écran générique
// ReferentielVenteAdmin pour la table taux_horaires_vente (prix MO = cadence × taux).
import React from "react";
import { Euro } from "lucide-react";
import ReferentielVenteAdmin from "./ReferentielVenteAdmin.jsx";
import { REFERENTIEL_TAUX, formaterTauxHT } from "./tauxHorairesVente.mjs";

export default function TauxHorairesVenteAdmin({ T, acc, profil }) {
  return (
    <ReferentielVenteAdmin
      T={T} acc={acc} profil={profil}
      referentiel={REFERENTIEL_TAUX}
      table="taux_horaires_vente"
      colonneOuvrage="taux_horaire_vente_id"
      rpcDefaut="definir_taux_horaire_vente_defaut"
      titre="Taux horaires de main-d'œuvre"
      icone={Euro}
      colonneValeur="Taux HT/h"
      suffixe="€ HT/h"
      inputValeur={{ step: "0.5", min: "0.01", placeholder: "80" }}
      formaterValeur={formaterTauxHT}
      libelleAjout="Ajouter un taux"
      placeholderLibelle="Libellé (ex : Chef d'équipe)"
      description={<>
        Taux de <strong>vente</strong> HT/h proposés dans chaque fiche ouvrage (Bibliothèque). Prix de la main-d'œuvre d'un ouvrage = cadence (h/unité) × taux sélectionné ; le coefficient de vente ne s'applique qu'aux matériaux.
        Modifier un taux change le prix calculé des ouvrages qui l'utilisent <strong>pour les futurs chiffrages</strong> ; les devis déjà figés ne bougent pas.
      </>}
    />
  );
}
