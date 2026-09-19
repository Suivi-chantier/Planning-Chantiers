// src/Renovation/CoefficientsVenteAdmin.jsx — Réglages → Taux horaires →
// « Coefficients de vente » : instance de l'écran générique ReferentielVenteAdmin
// pour la table coefficients_vente (prix matériaux = coût matériaux × coefficient,
// idem coût direct complémentaire — formule v2 conservée).
import React from "react";
import { Percent } from "lucide-react";
import ReferentielVenteAdmin from "./ReferentielVenteAdmin.jsx";
import { REFERENTIEL_COEFFICIENTS, formaterCoefficient } from "./coefficientsVente.mjs";

export default function CoefficientsVenteAdmin({ T, acc, profil }) {
  return (
    <ReferentielVenteAdmin
      T={T} acc={acc} profil={profil}
      referentiel={REFERENTIEL_COEFFICIENTS}
      table="coefficients_vente"
      colonneOuvrage="coefficient_vente_id"
      rpcDefaut="definir_coefficient_vente_defaut"
      titre="Coefficients de vente"
      icone={Percent}
      colonneValeur="Coefficient"
      suffixe="×"
      inputValeur={{ step: "0.05", min: "0.0001", placeholder: "1,50" }}
      formaterValeur={formaterCoefficient}
      libelleAjout="Ajouter un coefficient"
      placeholderLibelle="Libellé (ex : Coefficient réduit)"
      description={<>
        Coefficients proposés dans chaque fiche ouvrage (Bibliothèque). Prix des matériaux d'un ouvrage = coût prévisionnel des matériaux × coefficient sélectionné (le coût direct complémentaire reçoit le même coefficient) ; la main-d'œuvre suit son taux horaire.
        Modifier un coefficient change le prix calculé des ouvrages qui l'utilisent <strong>pour les futurs chiffrages</strong> ; les lignes et devis déjà figés ne bougent pas.
      </>}
    />
  );
}
