import React, { useState } from "react";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { HelpCircle, X, Check, Info } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// AIDE PAR PAGE
// Bouton "?" global (dans la barre du haut) qui ouvre une fenêtre expliquant, en
// langage simple, à quoi sert la page courante et comment s'en servir. Le contenu
// est pensé pour un utilisateur NOVICE qui découvre l'application.
//
// Pour ajouter/éditer l'aide d'une page : compléter AIDE_CONTENU ci-dessous,
// la clé étant l'identifiant de page utilisé dans App.jsx (ex: "planning").
// Schéma d'une entrée :
//   { titre, sousTitre, intro, etapes: [..], savoir: [..], nouveautes? }
// ─────────────────────────────────────────────────────────────────────────────

export const AIDE_CONTENU = {
  dashboard: {
    titre: "Tableau de bord",
    sousTitre: "La page d'accueil : l'activité du jour en un coup d'œil.",
    intro: "Cette page résume ce qui se passe aujourd'hui : chantiers actifs, ouvriers attendus, commandes à passer, rapports reçus, et la météo de la semaine.",
    etapes: [
      "Lisez les chiffres clés en haut (chantiers actifs, ouvriers attendus, commandes à passer, rapports rendus).",
      "Parcourez la liste des chantiers du jour avec les ouvriers et les tâches prévues.",
      "Vérifiez combien de rapports d'ouvriers ont été reçus et lesquels manquent.",
    ],
    savoir: [
      "Vos tâches en retard apparaissent en rouge, celles du jour en orange.",
      "La météo se met à jour automatiquement ; vous pouvez changer de ville.",
    ],
  },
  chantiers: {
    titre: "Chantiers",
    sousTitre: "Le répertoire de tous vos chantiers et leurs fiches.",
    intro: "Retrouvez ici tous les chantiers avec leur statut, leur avancement, leurs photos et leurs informations financières.",
    etapes: [
      "Cliquez sur un chantier pour ouvrir sa fiche détaillée.",
      "Consultez l'avancement (%) et les chiffres (montant du marché, marge) calculés automatiquement.",
      "Ajoutez une photo et prenez des notes directement sur la fiche (sauvegarde automatique).",
      "Changez le statut d'un chantier (Planifié → En cours → Terminé) en un clic.",
    ],
    savoir: [
      "Les notes sont partagées : si plusieurs personnes écrivent, la dernière sauvegarde l'emporte.",
    ],
  },
  planning: {
    titre: "Planning de la semaine",
    sousTitre: "Qui travaille sur quel chantier, chaque jour de la semaine.",
    intro: "Un tableau avec les chantiers en lignes et les jours en colonnes. Chaque case dit qui fait quoi ce jour-là.",
    etapes: [
      "Cliquez sur une case (chantier + jour) pour ouvrir le formulaire de saisie.",
      "Indiquez les ouvriers prévus, les tâches (durée, responsable), une commande et une note si besoin.",
      "Changez de semaine avec les flèches, ou revenez à la semaine en cours avec « Aujourd'hui ».",
      "Vérifiez en bas le total d'heures par ouvrier pour éviter de surcharger quelqu'un.",
    ],
    savoir: [
      "Vous pouvez ajouter un événement à Google Agenda depuis une case remplie.",
    ],
  },
  "planning-mensuel": {
    titre: "Planning mensuel",
    sousTitre: "Un calendrier du mois pour les dates et objectifs importants.",
    intro: "Sert à planifier à plus long terme : objectifs, dates clés et remarques, sur l'ensemble du mois.",
    etapes: [
      "Cliquez sur un jour pour ajouter un événement.",
      "Choisissez le type (Objectif, Date importante ou Note), écrivez le texte et liez-le à un chantier si utile.",
      "Pour un événement sur plusieurs jours, cochez l'option et choisissez la date de fin.",
      "Imprimez ou exportez le récapitulatif du mois en un clic.",
    ],
    savoir: [
      "Vous pouvez filtrer par type d'événement ou par chantier pour y voir plus clair.",
    ],
  },
  "notes-todo": {
    titre: "Notes & To-do",
    sousTitre: "Vos tâches à faire (partagées) et vos notes libres (personnelles).",
    intro: "À gauche, une liste de tâches que l'on peut assigner et dater. À droite, un espace de notes libres qui se sauvegarde tout seul.",
    etapes: [
      "Tapez une tâche dans le champ prévu et appuyez sur Entrée.",
      "Réglez la priorité, assignez-la à quelqu'un et fixez une échéance (un e-mail prévient la personne).",
      "Cochez une tâche pour la marquer comme terminée, ou supprimez-la avec la croix.",
      "Écrivez vos notes à droite : elles se sauvegardent automatiquement.",
    ],
    savoir: [
      "Le filtre « Mes tâches » n'affiche que celles qui vous sont assignées.",
    ],
  },
  commandes: {
    titre: "Commandes (bureau)",
    sousTitre: "Consulter, compléter et gérer l'historique des commandes.",
    intro: "C'est ici qu'on organise au bureau tous les bons de commande et bons de livraison, et qu'on suit s'ils sont complétés et facturés.",
    etapes: [
      "Cliquez sur « Importer depuis document » pour scanner une facture / BL / bon de commande : l'IA en extrait les lignes.",
      "Vérifiez et complétez les informations (désignation, quantité, prix, fournisseur) et affectez chaque article à un chantier.",
      "Validez : la commande s'ajoute à la liste avec le statut « À compléter » ou « Complète ».",
      "Utilisez la vue groupée par fournisseur ou par chantier pour suivre les montants.",
    ],
    savoir: [
      "Les demandes envoyées par les ouvriers du terrain apparaissent à part : vous pouvez les transformer en vraies commandes.",
    ],
  },
  "capture-cmd": {
    titre: "Saisie d'une commande (mobile)",
    sousTitre: "Prendre en photo un bon ou un ticket pour l'enregistrer vite fait.",
    intro: "Conçue pour le terrain : on photographie un document (bon de livraison, ticket, facture) et l'IA en extrait automatiquement le contenu.",
    etapes: [
      "Choisissez le chantier et le type de document (comptoir, bon de commande, livraison).",
      "Prenez une ou plusieurs photos du document.",
      "Lancez l'analyse : l'IA lit le numéro, le fournisseur et les articles.",
      "Corrigez si besoin, cochez « Déjà payé » s'il n'y aura pas de facture, puis enregistrez.",
    ],
    savoir: [
      "Une même commande peut être répartie sur plusieurs chantiers.",
      "Le dernier chantier choisi est mémorisé pour gagner du temps.",
    ],
  },
  rapprochement: {
    titre: "Rapprochement des factures",
    sousTitre: "Vérifier qu'une facture fournisseur correspond bien aux bons reçus.",
    intro: "En fin de mois, on contrôle que chaque facture fournisseur correspond aux bons de livraison déjà saisis, et on repère les écarts.",
    etapes: [
      "Scannez la facture fournisseur : l'IA en extrait les numéros de bons et le montant total.",
      "Vérifiez que chaque bon détecté est bien relié à une commande existante ; sinon, créez-la sur place.",
      "Contrôlez que le total de la facture correspond à celui des bons (un écart est signalé).",
      "Cliquez « Confirmer le rapprochement » : les commandes passent en « Facturé ».",
    ],
    savoir: [
      "Si un bon de livraison n'a jamais été saisi, le système l'indique et vous empêche de confirmer tant qu'il manque : c'est le filet de sécurité anti-oubli.",
    ],
  },
  "planning-commandes": {
    titre: "Commandes",
    sousTitre: "Tout ce qu'il y a à commander, par chantier et par ouvrage.",
    intro: "Cette page rassemble tout ce qu'il faut commander pour les chantiers en cours. Pour chaque chantier, on retrouve ses ouvrages (les ensembles de travaux), et pour chaque ouvrage les matériaux à commander et ceux déjà commandés.",
    etapes: [
      "Choisissez un chantier dans la colonne de gauche (le chiffre orange indique ce qu'il reste à commander).",
      "Choisissez un ouvrage dans la colonne du milieu (les pastilles montrent l'état d'un coup d'œil).",
      "À droite, consultez « À commander » et « Déjà commandé » ; le bouton « Commander ces articles » prépare un e-mail par fournisseur.",
      "Le vendredi, le bouton « Commandes de la semaine » rassemble tout, par onglet de semaine, regroupé par fournisseur puis par chantier.",
    ],
    savoir: [
      "Les matériaux et les dates de besoin viennent du Phasage du chantier.",
      "Dès qu'un article est commandé, il quitte « À commander » : plus de risque de commander deux fois.",
      "Sur téléphone, les colonnes s'affichent une par une (bouton « Retour » pour revenir en arrière).",
    ],
    nouveautes: "Cette page remplace l'ancien planning en colonnes par semaine. Elle est désormais organisée par chantier et par ouvrage, suit précisément ce qui a déjà été commandé, et propose un bouton dédié pour préparer toutes les commandes de la semaine en une fois.",
  },
  equipe: {
    titre: "Équipe & bilan de semaine",
    sousTitre: "Les rapports des ouvriers et le bilan hebdomadaire consolidé.",
    intro: "Les ouvriers y déposent leurs rapports (tâches faites, remarques, photos). Vous générez ensuite un bilan de la semaine, exportable.",
    etapes: [
      "Consultez les rapports reçus (tâches, heures, remarques), mis à jour en temps réel.",
      "Cliquez sur « Bilan de la semaine » pour obtenir le résumé : heures par chantier, tâches faites / en cours / non faites.",
      "Si un ouvrier était sur plusieurs chantiers le même jour, répartissez ses heures quand on vous le demande.",
      "Exportez le bilan en Word, PDF, ou envoyez-le par e-mail.",
    ],
    savoir: [
      "Les tâches déclarées en double sont automatiquement fusionnées dans le bilan.",
    ],
  },
  validation: {
    titre: "Validation de fin de journée",
    sousTitre: "Valider les heures des ouvriers et créer le pointage.",
    intro: "Sert à vérifier et valider les rapports de travail saisis par les ouvriers ; une fois validés, ils alimentent le registre de pointage (heures et coûts).",
    etapes: [
      "Choisissez une date : tous les rapports du jour s'affichent avec leur statut.",
      "Ouvrez un rapport, vérifiez les tâches et les heures, réaffectez des lignes si nécessaire.",
      "Saisissez l'avancement de chaque tâche, puis validez le rapport.",
      "En fin de journée, « fermez la journée » pour verrouiller tous les pointages.",
    ],
    savoir: [
      "Tant qu'un rapport n'est pas validé, ses heures ne comptent pas dans le coût du chantier.",
      "Vous pouvez ajouter des heures indirectes (trajets, imprévus) depuis le formulaire.",
    ],
  },
  "heures-salaries": {
    titre: "Heures des salariés",
    sousTitre: "Vue par salarié pour préparer la paie du mois.",
    intro: "Un tableau avec les salariés en lignes et les jours en colonnes : le total d'heures validées de chacun, jour par jour. Contrairement aux vues de coût, on additionne TOUTES les heures payées (tâches, indirect, trajets), tous chantiers confondus.",
    etapes: [
      "Choisissez la granularité : jour, semaine ou mois (mois par défaut).",
      "Lisez le total de chaque salarié par jour et le total du mois sous son nom.",
      "En vue mois, le bandeau du haut indique s'il reste des CR à valider avant de clôturer la paie.",
      "Cliquez sur une case pour voir le détail (chantiers, tâches, heures indirectes) et remonter au CR source.",
      "Activez « Vue détaillée » pour éclater chaque case par chantier ; exportez le récapitulatif en CSV.",
    ],
    savoir: [
      "Une case n'apparaît que si le CR a été validé. « À valider » (bordure pointillée) = planifié mais pas encore validé.",
      "Cette page est en lecture seule : pour corriger une heure, revalidez le CR dans la page Validation.",
      "Le sous-total d'une semaine se colore au-delà de 35 h (alerte forte à 48 h) : c'est un simple repère, pas un calcul de majoration.",
      "Absences, clôture et export paie arriveront après décision avec le comptable.",
    ],
  },
  plans: {
    titre: "Plans du chantier",
    sousTitre: "Dessiner, mesurer et annoter les plans d'un chantier.",
    intro: "Permet de créer des plans (dessins, surfaces, symboles techniques) ou d'importer un fichier d'architecte (DXF).",
    etapes: [
      "Sélectionnez un chantier, puis ouvrez un plan existant ou créez-en un nouveau.",
      "Dessinez avec les outils (lignes, formes) ou importez un fichier DXF.",
      "Ajoutez des symboles (portes, prises, sanitaires…), mesurez des distances, colorez des surfaces.",
      "Exportez en PDF ou en image pour imprimer.",
    ],
    savoir: [
      "Les plans gèrent les calques (afficher/masquer) et l'annulation (undo/redo).",
    ],
  },
  "phasage-v2": {
    titre: "Phasage (découpage des travaux)",
    sousTitre: "Organiser un chantier en Lots → Ouvrages → Tâches.",
    intro: "C'est la colonne vertébrale d'un chantier : on découpe les travaux en lots (ex. Plâtrerie), en ouvrages (ex. cloison 10 m²), puis en tâches. C'est ici qu'on définit les matériaux et qu'on suit l'avancement et la marge.",
    etapes: [
      "Sélectionnez le chantier, créez les lots puis ajoutez des ouvrages dedans.",
      "Saisissez pour chaque ouvrage les heures estimées, le prix de vente, les quantités et les matériaux.",
      "Ajoutez les tâches de chaque ouvrage et affectez des ouvriers.",
      "Planifiez les tâches dans le calendrier et suivez l'avancement en direct.",
    ],
    savoir: [
      "Vous pouvez importer un devis Excel pour pré-remplir ouvrages et tâches.",
      "Les matériaux définis ici alimentent la page Commandes.",
    ],
  },
  bibliotheque: {
    titre: "Bibliothèque d'ouvrages types",
    sousTitre: "Des modèles d'ouvrages réutilisables pour aller plus vite.",
    intro: "On y crée des ouvrages « types » (avec leurs sous-tâches, cadences et matériaux) qui servent ensuite à remplir automatiquement les chantiers et les devis.",
    etapes: [
      "Créez un ouvrage type (ex. « Cloison 10 m² », unité « m² ») et ses sous-tâches.",
      "Indiquez la cadence (heures pour 1 unité, ex. 0,5 h par m²).",
      "Ajoutez les matériaux liés avec leur quantité par unité.",
      "Rangez les ouvrages en catégories pour les retrouver facilement.",
    ],
    savoir: [
      "Les cadences pré-remplissent les heures à l'import d'un devis.",
      "Les pourcentages des sous-tâches doivent totaliser 100 %.",
    ],
  },
  "biblio-materiaux": {
    titre: "Bibliothèque des matériaux",
    sousTitre: "Le catalogue des articles et de leurs fournisseurs.",
    intro: "Un catalogue centralisé d'articles réutilisables (matériaux, consommables) avec leurs prix, références et fournisseurs.",
    etapes: [
      "Importez en masse depuis un Google Sheet, ou ajoutez les articles un par un.",
      "Renseignez pour chaque article : désignation, référence, fournisseur, catégorie, prix unitaire, unité.",
      "Cherchez et filtrez par catégorie ou mot-clé pour retrouver un article.",
      "Modifiez ou supprimez un article à tout moment.",
    ],
    savoir: [
      "Ces articles se suggèrent automatiquement à la saisie d'une commande, ce qui garantit des prix cohérents.",
    ],
  },
  visite: {
    titre: "Visites de chantier",
    sousTitre: "Faire un audit terrain : valider les tâches et noter les réserves.",
    intro: "Sert à réaliser des visites de contrôle : on valide ce qui est fait, on note les réserves (reprises à faire), on ajoute photos et commentaires.",
    etapes: [
      "Créez une visite et choisissez les lots à contrôler.",
      "Pour chaque tâche, indiquez le statut (Validé / Réserve / Pas commencé) avec commentaires et photos.",
      "Remplissez la checklist sécurité/qualité (EPI, balisage, propreté…).",
      "Exportez en PDF ou Word et clôturez la visite.",
    ],
    savoir: [
      "Les réserves de la visite précédente s'affichent automatiquement pour relance.",
      "Cette page s'utilise surtout sur mobile ou tablette.",
    ],
  },
  "info-client": {
    titre: "Chiffrage (fiche projet)",
    sousTitre: "Préparer un devis : infos client, travaux et prix.",
    intro: "Sert à enregistrer un projet commercial : les informations du client, les travaux envisagés et le chiffrage, avant la signature.",
    etapes: [
      "Créez un nouveau projet ou sélectionnez-en un dans la liste.",
      "Remplissez les informations client et décrivez les travaux.",
      "Sélectionnez les ouvrages par catégorie et saisissez quantités et prix.",
      "Ajoutez des photos, créez des plans, puis exportez une fiche Word pour le client.",
    ],
    savoir: [
      "Le statut suit l'avancement commercial (Prospect → Visite → Chiffrage → Devis envoyé → Signé).",
      "La page sauvegarde toute seule au fur et à mesure (un indicateur le montre en haut).",
    ],
  },
  "dashboard-analyse": {
    titre: "Analyse & rentabilité",
    sousTitre: "Piloter la santé financière de tous les chantiers.",
    intro: "Vue de pilotage : chiffre d'affaires, marges et alertes pour repérer d'un coup d'œil les chantiers qui vont bien et ceux à surveiller.",
    etapes: [
      "Lisez les indicateurs en tête (chiffre d'affaires, marge réelle, alertes, ratio d'heures).",
      "Parcourez le tableau des chantiers actifs : avancement, main-d'œuvre consommée, marge réelle.",
      "Repérez les chantiers en alerte (rouge) et ceux qui vont bien (vert).",
      "Suivez le pipeline commercial (opportunités et probabilité de signature).",
    ],
    savoir: [
      "Chaque chantier affiche 3 repères : avancement réel vs prévu, heures consommées vs budget, marge réelle vs cible.",
    ],
  },
  "etats-financiers": {
    titre: "États financiers",
    sousTitre: "Suivre et valider l'avancement financier, mois par mois.",
    intro: "Permet de figer chaque mois la situation financière des chantiers : avancement déclaré, montant facturé et provision comptable.",
    etapes: [
      "Choisissez un mois dans la liste.",
      "Le tableau affiche chaque chantier avec son avancement, le montant facturé et la provision.",
      "Corrigez les données si nécessaire, puis validez la ligne pour la verrouiller.",
      "En fin de mois, générez l'export comptable.",
    ],
    savoir: [
      "Une ligne verrouillée ne peut plus être modifiée par erreur ; déverrouillez-la pour corriger.",
    ],
  },
  "guide-ouvrages": {
    titre: "Guide ouvrages",
    sousTitre: "Le référentiel technique des normes et bonnes pratiques.",
    intro: "Un guide visuel des normes et bonnes pratiques (électricité, plomberie, menuiserie…) : une « bible technique » à portée de main.",
    etapes: [
      "Parcourez les sections par domaine.",
      "Servez-vous-en pour vérifier une norme pendant une visite ou un chantier.",
      "Imprimez les pages utiles pour l'équipe terrain.",
    ],
    savoir: [
      "Le guide s'ouvre dans sa propre fenêtre et peut être imprimé directement.",
    ],
  },
  admin: {
    titre: "Réglages",
    sousTitre: "Configurer l'application : équipe, ouvriers, fournisseurs…",
    intro: "Le centre de configuration : collaborateurs et droits d'accès, ouvriers et taux horaires, lots de travaux, fournisseurs et modèles d'e-mails.",
    etapes: [
      "« Collaborateurs » : invitez des membres et donnez-leur un rôle et des accès.",
      "« Ouvriers » / « Lots » : définissez les ressources de base (noms, taux horaires, catégories de travaux).",
      "« Fournisseurs » : listez vos fournisseurs et créez des modèles d'e-mail de commande.",
    ],
    savoir: [
      "Les lots sont la base de toute la planification : modifiez-les avec prudence, ils s'appliquent à tous les chantiers.",
    ],
  },
};

// ─── BOUTON + FENÊTRE D'AIDE ─────────────────────────────────────────────────
// Apparence paramétrable pour s'intégrer aussi bien dans la barre du haut (mobile)
// que dans la sidebar (desktop) : passer `style` + `hoverBg` pour aligner le look.
export default function BoutonAide({ page, T, branch = "renovation", style, iconSize = 16, hoverBg, className = "btn-g" }) {
  const [open, setOpen] = useState(false);
  const contenu = AIDE_CONTENU[page];
  if (!contenu) return null; // pas d'aide pour cette page → pas de bouton

  const acc = getBranchAccent(branch);
  const textMuted = T?.textMuted || "#5b6a8a";
  const baseStyle = style || {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "6px 10px", color: textMuted, cursor: "pointer",
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Comment ça marche ?"
        aria-label="Aide sur cette page"
        className={style ? undefined : className}
        style={baseStyle}
        onMouseEnter={hoverBg ? (e) => { e.currentTarget.style.background = hoverBg; } : undefined}
        onMouseLeave={hoverBg ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}
      >
        <Icon as={HelpCircle} size={iconSize}/>
      </button>
      {open && <FenetreAide contenu={contenu} acc={acc} T={T} onClose={() => setOpen(false)}/>}
    </>
  );
}

function FenetreAide({ contenu, acc, T, onClose }) {
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const accent    = acc?.accent  || "#FFC200";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", zIndex: 990, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T?.modal || surface, borderRadius: RADIUS.xl,
        width: "100%", maxWidth: 680, maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${border}`, boxShadow: "0 28px 70px rgba(0,0,0,0.65)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 38, height: 38, borderRadius: RADIUS.md, background: accent + "22", color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={HelpCircle} size={20}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text }}>{contenu.titre}</div>
            {contenu.sousTitre && <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 2 }}>{contenu.sousTitre}</div>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: textMuted, cursor: "pointer", padding: 6, display: "flex" }}>
            <Icon as={X} size={18}/>
          </button>
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px", fontSize: FONT.sm.size + 1 }}>
          {contenu.intro && (
            <p style={{ margin: "0 0 16px", color: textSub, lineHeight: 1.65 }}>{contenu.intro}</p>
          )}

          {contenu.etapes?.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Comment s'en servir
              </div>
              <div style={{ marginBottom: 8 }}>
                {contenu.etapes.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                      background: accent + "22", color: accent, fontWeight: 800, fontSize: 12,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: FONT.sm.size + 1, color: textSub, lineHeight: 1.55, paddingTop: 2 }}>{e}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {contenu.savoir?.length > 0 && (
            <div style={{ marginTop: 8, padding: "12px 14px", background: card, border: `1px solid ${border}`, borderRadius: RADIUS.md }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Bon à savoir
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: textSub, lineHeight: 1.7 }}>
                {contenu.savoir.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {contenu.nouveautes && (
            <div style={{ marginTop: 14, padding: "12px 14px", background: accent + "12", border: `1px solid ${accent}40`, borderRadius: RADIUS.md }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon as={Info} size={14} color={accent}/>
                <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: text }}>Ce qui vient de changer</span>
              </div>
              <div style={{ fontSize: FONT.sm.size + 1, color: textSub, lineHeight: 1.6 }}>{contenu.nouveautes}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 22px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button onClick={onClose} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: accent, color: "#1a1a1a", border: "none",
            borderRadius: RADIUS.md, padding: "9px 20px", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
          }}>
            <Icon as={Check} size={14}/> J'ai compris
          </button>
        </div>
      </div>
    </div>
  );
}
