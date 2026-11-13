// ─────────────────────────────────────────────────────────────────────────────
// Charte des documents Profero — UNE SEULE SOURCE pour les couleurs et le décor
// du héros (bleu nuit à halos, jaune marque, filet des titres, polices).
//
// Utilisée par :
//   - previsionnelDoc.js (docClientHTML, sectionTitre) et donc tous les
//     documents client au gabarit commun (planning prévisionnel, dossier de
//     plans, compte rendu client, encours, opération, chiffrage…) ;
//   - bilanPdfV3.mjs (PDF du Bilan, versions direction et détaillée).
// Toute évolution du décor se fait ICI, une seule fois.
//
// Module PUR : uniquement des constantes (aucun accès réseau, aucune horloge).
// ─────────────────────────────────────────────────────────────────────────────

// Couleurs de la charte (skill « profero-pdf »).
export const OR = "#FFC200";               // jaune marque Profero (accent)
export const ENCRE = "#1a1f2e";            // encre principale / fond du héros
export const TEXTE_SECONDAIRE = "#5a6478"; // texte secondaire
export const BORDURE = "#e4e8f2";          // bordures des cartes et tableaux
export const FOND_DOUX = "#eef1f7";        // séparateurs / fonds doux
export const FOND_PAGE = "#f4f6fa";        // fond doux de page
export const JAUNE_PALE = "#fff8dc";       // ligne de total des tableaux

// Fond du héros : dégradé sombre (même langage que l'app, src/mobileUI.jsx).
export const FOND_HERO = "linear-gradient(135deg,#161b28 0%,#232c42 55%,#2e2840 100%)";

// ⚠ AUCUN DÉGRADÉ VERS LE TRANSPARENT dans ces documents.
// Chrome enregistre un dégradé dont une couleur est transparente (rgba(…, 0),
// « transparent ») sous forme de masque de transparence dans le PDF. L'Aperçu
// du Mac l'affiche mal : halos du héros en disques pleins cerclés de noir,
// filets des titres jaunes d'un bout à l'autre (constaté le 29/09/2026 sur un
// compte rendu client ; Chrome sous Windows l'affichait bien). Chaque dégradé
// est donc écrit en couleurs PLEINES, précalculées sur le fond qu'il recouvre :
//   filet des titres : jaune → blanc (fond de page) ;
//   halo ambre (30 % de #FFC200) sur le héros au coin haut-droit (#292a41) ;
//   halo bleu  (26 % de #5b8af5) sur le héros au coin bas-gauche (#1c2334).
// Rendu identique à l'œil (écart de fond < 5/255 selon la hauteur du héros).
// Contrôlé par scripts/verif-compte-rendu-client-doc.mjs.
export const HALO_OR = "radial-gradient(circle,#69582d 0%,#292a41 68%)";
export const HALO_BLEU = "radial-gradient(circle,#2c3e66 0%,#1c2334 68%)";
export const FILET_TITRE = `linear-gradient(90deg,${OR},#fff)`;

// Polices : Barlow (texte, 400 à 700) et Barlow Condensed (titres, chiffres),
// repli Arial. Même lien Google Fonts que index.html.
export const POLICES_GOOGLE = "https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Barlow+Condensed:wght@600;700;800&display=swap";
export const POLICE_TEXTE = "'Barlow',Arial,Helvetica,sans-serif";
export const POLICE_TITRE = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";

// Pied de page des documents (écrit en majuscules par le CSS).
export const PIED_GAUCHE = "Profero — Rénovation & réhabilitation";
