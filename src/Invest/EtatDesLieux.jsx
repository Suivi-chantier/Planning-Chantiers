import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  listerEDL, chargerEDL, creerEDL, majEDL, supprimerEDL,
  idbAdd, idbList, idbDelete, idbClear,
  archiverPhotos, signerPhotos, recompresser, fichierVersDataUrl,
} from "./edlStore";

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAT DES LIEUX CONTRADICTOIRE — page autonome de Profero Invest
//
// Cette page conserve volontairement sa propre charte (papier / bleu Majorelle)
// et non le thème sombre de l'app : c'est un document juridique destiné à être
// imprimé et signé, pas un écran de pilotage. Tous les styles sont donc scopés
// sous `.edl` (saisie) et `.edl-report-portal` (rapport) pour ne pas fuiter.
//
// Persistance : localStorage (hors photos, trop lourdes) + export/import d'un
// dossier .json complet (photos et signatures comprises).
// ─────────────────────────────────────────────────────────────────────────────

/* ============ Référentiel du bien ============ */
const ROOMS = [
 {id:"E", name:"Entrée & dégagement", note:"Section ajoutée : elle n'apparaissait pas dans l'annexe rédigée. Relevez la serrure et le tableau électrique dès l'arrivée.", warn:true, items:[
  {c:"E-01",l:"Porte palière, serrure et cylindre"},
  {c:"E-02",l:"Sonnette / interphone"},
  {c:"E-03",l:"Tableau électrique et disjoncteurs"},
  {c:"E-04",l:"Sol du dégagement"},
  {c:"E-05",l:"Murs et plafond du dégagement"},
  {c:"E-06",l:"Interrupteurs, prises, éclairage"},
  {c:"E-07",l:"Placard / rangement d'entrée"}
 ]},
 {id:"C1", name:"Chambre 1 — Suite parentale", note:"Mur d'accent rouge brique mat, autres murs blancs. Photographiez le mur d'accent de face et en biais.", items:[
  {c:"C1-01",l:"Grand lit double : sommier et matelas"},
  {c:"C1-02",l:"Tête de lit artisanale fixe, bois sculpté et ajouré"},
  {c:"C1-03",l:"Tables de chevet bois clair, tiroirs blancs", q:2},
  {c:"C1-04",l:"Luminaires de chevet", q:2},
  {c:"C1-05",l:"Téléviseur écran plat fixé au mur (+ télécommande)"},
  {c:"C1-06",l:"Support mural TV et câblage"},
  {c:"C1-07",l:"Climatiseur split (+ télécommande, test de mise en route)"},
  {c:"C1-08",l:"Mur d'accent rouge brique mat"},
  {c:"C1-09",l:"Murs blancs et plafond"},
  {c:"C1-10",l:"Revêtement de sol"},
  {c:"C1-11",l:"Fenêtre, vitrage, volet / store"},
  {c:"C1-12",l:"Placard / penderie"},
  {c:"C1-13",l:"Jeu de draps complet fourni"},
  {c:"C1-14",l:"Coussins et oreillers fournis", f:"Nombre"},
  {c:"C1-15",l:"Prises, interrupteurs, éclairage plafond"}
 ]},
 {id:"C2", name:"Chambre 2", note:"Configuration identique à la suite parentale : lit double, tête de lit ajourée, un pan rouge brique.", items:[
  {c:"C2-01",l:"Grand lit double : sommier et matelas"},
  {c:"C2-02",l:"Parure de lit"},
  {c:"C2-03",l:"Tête de lit bois ajouré, style marocain"},
  {c:"C2-04",l:"Tables de chevet bois et blanc", q:2},
  {c:"C2-05",l:"Lampes de chevet", q:2},
  {c:"C2-06",l:"Climatiseur split (+ télécommande)"},
  {c:"C2-07",l:"Murs (pan rouge brique + murs blancs) et plafond"},
  {c:"C2-08",l:"Sol imitation parquet"},
  {c:"C2-09",l:"Fenêtre, vitrage, volet"},
  {c:"C2-10",l:"Placard / penderie"},
  {c:"C2-11",l:"Jeu de draps complet fourni"},
  {c:"C2-12",l:"Coussins et oreillers fournis", f:"Nombre"},
  {c:"C2-13",l:"Prises, interrupteurs, éclairage"}
 ]},
 {id:"C3", name:"Chambre 3", items:[
  {c:"C3-01",l:"Lits simples avec sommiers et matelas", q:2},
  {c:"C3-02",l:"Têtes de lit en bois ciselé", q:2},
  {c:"C3-03",l:"Murs peints et plafond"},
  {c:"C3-04",l:"Sol parquet stratifié clair"},
  {c:"C3-05",l:"Fenêtres vitrées et volets roulants intégrés (test montée/descente)"},
  {c:"C3-06",l:"Jeux de draps complets", q:2},
  {c:"C3-07",l:"Coussins et oreillers", f:"Nombre"},
  {c:"C3-08",l:"Placard / rangement"},
  {c:"C3-09",l:"Climatisation ou ventilation"},
  {c:"C3-10",l:"Prises, interrupteurs, éclairage"}
 ]},
 {id:"S", name:"Salon", items:[
  {c:"S-01",l:"Canapé d'angle modulable gris anthracite, assise capitonnée"},
  {c:"S-02",l:"Fauteuil individuel assorti, tissu gris foncé"},
  {c:"S-03",l:"Table basse rectangulaire, plateau blanc et piètement bois"},
  {c:"S-04",l:"Meuble TV bas blanc"},
  {c:"S-05",l:"Téléviseur écran plat (+ télécommande)"},
  {c:"S-06",l:"Grand tapis à motifs géométriques"},
  {c:"S-07",l:"Suspension lumineuse de plafond"},
  {c:"S-08",l:"Baie vitrée coulissante aluminium, rails et serrure"},
  {c:"S-09",l:"Murs et plafond"},
  {c:"S-10",l:"Revêtement de sol"},
  {c:"S-11",l:"Climatiseur / chauffage d'appoint"},
  {c:"S-12",l:"Rideaux, voilages, tringles"},
  {c:"S-13",l:"Prises, interrupteurs, éclairage"}
 ]},
 {id:"K", name:"Cuisine américaine", note:"Ouvrez chaque appareil, faites un cycle court si possible et photographiez l'intérieur du four et du réfrigérateur.", items:[
  {c:"K-01",l:"Meubles hauts laqués blancs, ouverture sans poignée"},
  {c:"K-02",l:"Meubles bas laqués blancs"},
  {c:"K-03",l:"Plan de travail principal adossé au mur"},
  {c:"K-04",l:"Crédence grès cérame effet marbre gris foncé"},
  {c:"K-05",l:"Évier, robinetterie, siphon et évacuation"},
  {c:"K-06",l:"Poubelle cylindrique inox"},
  {c:"K-07",l:"Îlot central (plan libre et coin repas)"},
  {c:"K-08",l:"Tabourets hauts bois blanc, assises grises", q:3},
  {c:"K-09",l:"Plaque de cuisson (test de tous les feux)"},
  {c:"K-10",l:"Hotte aspirante (test moteur et éclairage)"},
  {c:"K-11",l:"Réfrigérateur / congélateur encastré"},
  {c:"K-12",l:"Lave-linge intégré"},
  {c:"K-13",l:"Lave-vaisselle sous l'îlot"},
  {c:"K-14",l:"Four électrique encastré inox"},
  {c:"K-15",l:"Four à micro-ondes encastré"},
  {c:"K-16",l:"Suspensions opaline blanche au-dessus de l'îlot", q:3},
  {c:"K-17",l:"Machine à café à capsules"},
  {c:"K-18",l:"Assiettes", f:"Nombre"},
  {c:"K-19",l:"Verres", f:"Nombre"},
  {c:"K-20",l:"Couverts de table", f:"Nombre"},
  {c:"K-21",l:"Casseroles et poêles", f:"Nombre"},
  {c:"K-22",l:"Ustensiles de cuisine"},
  {c:"K-23",l:"Petit électroménager rangé dans les placards"},
  {c:"K-24",l:"Sol de la cuisine"},
  {c:"K-25",l:"Murs et plafond"},
  {c:"K-26",l:"Prises, interrupteurs, éclairage"}
 ]},
 {id:"B1", name:"Salle de bain 1", note:"Section ajoutée : les pièces d'eau ne figuraient pas dans l'annexe rédigée. C'est la zone la plus contestée en fin de bail, documentez-la finement.", warn:true, items:[
  {c:"B1-01",l:"Douche ou baignoire, receveur et évacuation"},
  {c:"B1-02",l:"Robinetterie, flexible, pomme de douche"},
  {c:"B1-03",l:"Paroi de douche ou rideau"},
  {c:"B1-04",l:"Vasque, meuble sous-vasque, miroir"},
  {c:"B1-05",l:"WC, abattant, mécanisme de chasse"},
  {c:"B1-06",l:"Sèche-serviettes / radiateur"},
  {c:"B1-07",l:"Chauffe-eau (marque, capacité, mise en service)"},
  {c:"B1-08",l:"Faïence, joints, silicone"},
  {c:"B1-09",l:"Sol"},
  {c:"B1-10",l:"VMC / ventilation"},
  {c:"B1-11",l:"Éclairage et prises"},
  {c:"B1-12",l:"Linge de toilette fourni", f:"Nombre"}
 ]},
 {id:"B2", name:"Salle d'eau 2 / WC", note:"À supprimer du rapport si le logement n'en comporte pas : laissez tous les éléments sur « Sans objet ».", warn:true, items:[
  {c:"B2-01",l:"Douche, receveur et évacuation"},
  {c:"B2-02",l:"Robinetterie"},
  {c:"B2-03",l:"Vasque, meuble, miroir"},
  {c:"B2-04",l:"WC, abattant, mécanisme de chasse"},
  {c:"B2-05",l:"Faïence, joints, silicone"},
  {c:"B2-06",l:"Sol, murs et plafond"},
  {c:"B2-07",l:"Ventilation, éclairage, prises"}
 ]},
 {id:"T", name:"Terrasse (134 m²)", note:"Mention réglementaire : l'ensemble des coussins du salon de jardin a été changé à neuf et est de couleur blanche. Photographiez-les à part.", items:[
  {c:"T-01",l:"Canapé extérieur 2 places"},
  {c:"T-02",l:"Fauteuils extérieurs individuels", q:2},
  {c:"T-03",l:"Coussins d'assise et de dossier — NEUFS, couleur blanche", f:"Nombre"},
  {c:"T-04",l:"Table basse extérieure en lattes"},
  {c:"T-05",l:"Chaises longues / bains de soleil, toiles foncées", q:2},
  {c:"T-06",l:"Tables d'appoint d'extérieur", q:2},
  {c:"T-07",l:"Grand parasol blanc et son pied"},
  {c:"T-08",l:"Bacs à plantes maçonnés et muret orange brique"},
  {c:"T-09",l:"Plantations (mini-palmiers, plantes vertes)"},
  {c:"T-10",l:"Revêtement de sol de la terrasse"},
  {c:"T-11",l:"Garde-corps, murets, étanchéité apparente"},
  {c:"T-12",l:"Éclairage extérieur"},
  {c:"T-13",l:"Point d'eau et évacuations"},
  {c:"T-14",l:"Étendoir, local technique, rangements extérieurs"}
 ]},
 {id:"G", name:"Compteurs, clés & général", note:"Relevez les index devant le bailleur : c'est ce qui coupe court aux litiges de charges.", items:[
  {c:"G-01",l:"Compteur électricité — index relevé", f:"Index kWh"},
  {c:"G-02",l:"Compteur eau — index relevé", f:"Index m³"},
  {c:"G-03",l:"Clés de la porte palière remises", f:"Nombre"},
  {c:"G-04",l:"Clés / badges immeuble et boîte aux lettres", f:"Nombre"},
  {c:"G-05",l:"Télécommande portail ou parking", f:"Nombre"},
  {c:"G-06",l:"Place de parking, cave ou local vélo"},
  {c:"G-07",l:"Détecteur de fumée / extincteur"},
  {c:"G-08",l:"Box internet et identifiants wifi"},
  {c:"G-09",l:"Production d'eau chaude sanitaire"},
  {c:"G-10",l:"Propreté générale à la remise des clés"},
  {c:"G-11",l:"Notices, garanties et modes d'emploi remis"}
 ]}
];

const STATES = [
 {k:"NEUF",l:"Neuf"},{k:"TB",l:"Très bon"},{k:"BON",l:"Bon"},
 {k:"USAGE",l:"État d'usage"},{k:"MAUVAIS",l:"Mauvais"},{k:"ABSENT",l:"Absent"},{k:"NA",l:"Sans objet"}
];
const STATE_LABEL = Object.fromEntries(STATES.map(s => [s.k, s.l]));
const RESERVE = new Set(["MAUVAIS","ABSENT"]);
const DOTCOL = {NEUF:"#1C6E52",TB:"#1C6E52",BON:"#3C7F5C",USAGE:"#B8860F",MAUVAIS:"#A8452F",ABSENT:"#A8452F",NA:"#9A9CB0"};
const CLS = {NEUF:"e-ok",TB:"e-ok",BON:"e-ok",USAGE:"e-mid",MAUVAIS:"e-bad",ABSENT:"e-bad",NA:"e-na"};

const ALL_ITEMS = ROOMS.flatMap(r => r.items.map(item => ({ room:r, item })));
const EMPTY_ITEM = { s:null, o:"", v:"", p:[] };

const DEFAULT_META = {
  type:"ENTRÉE", date:"2026-08-17", heure:"",
  bailleur:"M. Philippe AGUERRE",
  loc1:"M. Matthieu FUMOLEAU",
  loc2:"Mme Camille LANDAIS épouse FUMOLEAU",
  adresse:"Résidence Al Hana, Appartement 16, 4ème étage, Guéliz, 40000 Marrakech, Maroc",
  surface:"Appartement meublé 3 chambres + terrasse 134 m²",
  tiers:"",
};

const METAFIELDS = [
  { k:"type",     label:"Type d'état des lieux", type:"select" },
  { k:"date",     label:"Date",                  type:"date"   },
  { k:"heure",    label:"Heure",                 type:"time"   },
  { k:"bailleur", label:"Bailleur"               },
  { k:"loc1",     label:"Locataire 1"            },
  { k:"loc2",     label:"Locataire 2"            },
  { k:"adresse",  label:"Adresse du bien"        },
  { k:"surface",  label:"Surface / composition"  },
  { k:"tiers",    label:"Tiers présents (agent, témoin)" },
];

const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap";

/* ============ Feuille de style scopée ============ */
const EDL_CSS = `
.edl,.edl-report-portal{
  --majorelle:#2E2AA8;
  --majorelle-soft:#EEEDFB;
  --ink:#15172B;
  --ink-60:#5A5C74;
  --ink-30:#9A9CB0;
  --sand:#F0EEE7;
  --line:#DEDBD1;
  --surface:#FFFFFF;
  --brick:#A8452F;
  --saffron:#B8860F;
  --pine:#1C6E52;
  --radius:6px;
  --display:'Archivo','Barlow Condensed','Helvetica Neue',Arial,sans-serif;
  --body:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,'SF Mono',Menlo,monospace;
}
.edl *,.edl-report-portal *{box-sizing:border-box}
.edl{
  background:var(--sand);color:var(--ink);font-family:var(--body);
  font-size:15px;line-height:1.5;-webkit-text-size-adjust:100%;
  display:flex;flex-direction:column;min-height:100%;
}
.edl button,.edl input,.edl select,.edl textarea,
.edl-report-portal button{font-family:inherit;font-size:inherit;color:inherit}
.edl :focus-visible,.edl-report-portal :focus-visible{outline:2px solid var(--majorelle);outline-offset:2px}

/* ---------- En-tête ---------- */
.edl .masthead{background:var(--ink);color:#fff;padding:18px 20px 16px}
.edl .masthead .eyebrow{
  font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;
  color:#8F92FF;margin:0 0 8px
}
.edl .masthead h1{
  font-family:var(--display);font-weight:800;font-size:clamp(21px,4.6vw,30px);
  letter-spacing:-.02em;line-height:1.08;margin:0
}
.edl .masthead h1 em{font-style:normal;color:#8F92FF}
.edl .masthead .sub{font-size:13px;color:#B9BBCF;margin:8px 0 0}

/* ---------- Barre d'onglets pièces ---------- */
.edl .roomnav{
  position:sticky;top:0;z-index:40;background:var(--sand);
  border-bottom:1px solid var(--line);
  display:flex;gap:6px;overflow-x:auto;padding:10px 14px;scrollbar-width:thin;
}
.edl .roomtab{
  flex:0 0 auto;display:flex;align-items:center;gap:8px;
  background:var(--surface);border:1px solid var(--line);border-radius:100px;
  padding:7px 13px;cursor:pointer;white-space:nowrap;font-size:13px;font-weight:500;
  transition:background .12s,border-color .12s,color .12s;
}
.edl .roomtab:hover{border-color:var(--ink-30)}
.edl .roomtab[aria-selected="true"]{background:var(--majorelle);border-color:var(--majorelle);color:#fff}
.edl .roomtab .tick{font-family:var(--mono);font-size:10.5px;opacity:.6}
.edl .roomtab[aria-selected="true"] .tick{opacity:.85}
.edl .roomtab.done .tick{color:var(--pine);opacity:1;font-weight:600}
.edl .roomtab[aria-selected="true"].done .tick{color:#9BE8CB}

.edl .wrap{flex:1;width:100%;max-width:940px;margin:0 auto;padding:20px 14px 40px}

/* ---------- Cartes ---------- */
.edl .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:16px}
.edl .card-hd{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.edl .card-hd h2{font-family:var(--display);font-weight:700;font-size:16px;letter-spacing:-.01em;margin:0}
.edl .card-hd .hint{font-size:12.5px;color:var(--ink-60);margin:0}
.edl .card-bd{padding:16px}
.edl .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.edl label.f{display:block}
.edl label.f > span{
  display:block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-60);margin-bottom:5px
}
.edl input[type=text],.edl input[type=date],.edl input[type=time],.edl select,.edl textarea{
  width:100%;padding:9px 11px;background:#FCFCFA;border:1px solid var(--line);
  border-radius:var(--radius);
}
.edl input:hover,.edl textarea:hover,.edl select:hover{border-color:var(--ink-30)}
.edl textarea{resize:vertical;min-height:64px}

/* ---------- Fiche élément ---------- */
.edl .room-note{
  font-size:13px;color:var(--ink-60);background:var(--majorelle-soft);
  border-left:3px solid var(--majorelle);padding:10px 13px;border-radius:0 var(--radius) var(--radius) 0;margin:0 0 14px
}
.edl .room-note.warn{background:#FBF3E2;border-left-color:var(--saffron);color:#6A5310}

.edl .item{
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  margin-bottom:10px;display:grid;grid-template-columns:58px 1fr;overflow:hidden
}
.edl .item .rail{
  background:#F7F6F2;border-right:1px solid var(--line);
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  padding:12px 4px;gap:8px
}
.edl .item .code{font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--ink-60);letter-spacing:.02em}
.edl .item .dot{width:9px;height:9px;border-radius:50%;background:var(--line)}
.edl .item .bd{padding:12px 14px}
.edl .item h3{font-family:var(--body);font-weight:600;font-size:14.5px;margin:0 0 2px;line-height:1.35}
.edl .item .qty{font-family:var(--mono);font-size:11px;color:var(--ink-60)}
.edl .item .refline{font-family:var(--mono);font-size:11px;color:var(--majorelle);margin-top:4px}

.edl .scale{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0 0}
.edl .scale button{
  border:1px solid var(--line);background:#FCFCFA;border-radius:100px;padding:5px 11px;
  font-size:12.5px;cursor:pointer;transition:.12s
}
.edl .scale button:hover{border-color:var(--ink-30)}
.edl .scale button[aria-pressed="true"]{color:#fff;border-color:transparent;font-weight:500}
.edl .scale button[data-s="NEUF"][aria-pressed="true"],
.edl .scale button[data-s="TB"][aria-pressed="true"]{background:var(--pine)}
.edl .scale button[data-s="BON"][aria-pressed="true"]{background:#3C7F5C}
.edl .scale button[data-s="USAGE"][aria-pressed="true"]{background:var(--saffron)}
.edl .scale button[data-s="MAUVAIS"][aria-pressed="true"],
.edl .scale button[data-s="ABSENT"][aria-pressed="true"]{background:var(--brick)}
.edl .scale button[data-s="NA"][aria-pressed="true"]{background:var(--ink-30)}

.edl .item .extra{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px}
.edl .item .extra label.f{flex:0 0 150px}
.edl .obs{margin-top:10px}
.edl .obs textarea{min-height:46px;font-size:13.5px}

.edl .photos{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;align-items:center}
.edl .thumb{position:relative;width:66px;height:66px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line)}
.edl .thumb img{width:100%;height:100%;object-fit:cover;display:block}
.edl .thumb button{
  position:absolute;top:2px;right:2px;width:19px;height:19px;border:0;border-radius:50%;
  background:rgba(21,23,43,.82);color:#fff;font-size:12px;line-height:1;cursor:pointer;padding:0
}
.edl .addphoto{
  width:66px;height:66px;border:1px dashed var(--ink-30);border-radius:var(--radius);background:#FCFCFA;
  cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  font-family:var(--mono);font-size:9.5px;color:var(--ink-60);letter-spacing:.06em
}
.edl .addphoto:hover{border-color:var(--majorelle);color:var(--majorelle)}
.edl .addphoto .plus{font-size:17px;line-height:1}

.edl .btn,.edl-report-portal .btn{
  border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:var(--radius);
  padding:9px 15px;font-size:13.5px;font-weight:500;cursor:pointer
}
.edl .btn:hover,.edl-report-portal .btn:hover{background:#000}
.edl .btn.ghost,.edl-report-portal .btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
.edl .btn.ghost:hover{background:#fff;border-color:var(--ink-30)}
.edl .btn.primary,.edl-report-portal .btn.primary{background:var(--majorelle);border-color:var(--majorelle)}
.edl .btn.primary:hover,.edl-report-portal .btn.primary:hover{background:#231FA0}
.edl .btn.sm{padding:6px 11px;font-size:12.5px}

.edl .rowbtns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}

/* ---------- Barre d'action ---------- */
.edl .actionbar{
  position:sticky;bottom:0;z-index:45;background:var(--ink);color:#fff;
  padding:10px 14px calc(10px + env(safe-area-inset-bottom));
  display:flex;align-items:center;gap:12px;flex-wrap:wrap
}
.edl .actionbar .stats{display:flex;gap:16px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;flex:1 1 auto}
.edl .actionbar .stats b{display:block;font-size:15px;font-weight:600;letter-spacing:0}
.edl .actionbar .stats .lab{color:#8E90A8;font-size:9.5px;text-transform:uppercase;letter-spacing:.14em}
.edl .actionbar .reserves b{color:#FF9B7A}
.edl .actionbar .acts{display:flex;gap:8px;flex-wrap:wrap}
.edl .actionbar .btn.ghost{color:#fff;border-color:#3A3D5A}
.edl .actionbar .btn.ghost:hover{background:#22253F;border-color:#5A5D80}

.edl .toast{
  position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:60;
  background:var(--pine);color:#fff;padding:9px 16px;border-radius:100px;font-size:13px;
  opacity:0;pointer-events:none;transition:opacity .2s
}
.edl .toast.show{opacity:1}

/* ---------- Signatures ---------- */
.edl .sigbox{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:#FCFCFA}
.edl .sigbox .lab{
  padding:7px 11px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:10px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--ink-60);display:flex;justify-content:space-between;align-items:center
}
.edl .sigbox canvas{display:block;width:100%;height:130px;touch-action:none;background:#fff;cursor:crosshair}
.edl .sigbox .lab button{border:0;background:none;color:var(--brick);cursor:pointer;font-size:11px;letter-spacing:.04em}
.edl .sigbox .who{padding:7px 11px;font-size:12px;color:var(--ink-60)}

/* ---------- Rapport ---------- */
.edl-report-portal{
  position:fixed;inset:0;z-index:100000;overflow:auto;
  background:#6E7080;color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.5;
  padding-bottom:60px;
}
.edl-report-portal .sheet{
  background:#fff;max-width:820px;margin:24px auto 18px;padding:34px 40px;
  box-shadow:0 3px 22px rgba(0,0,0,.28);color:var(--ink)
}
.edl-report-portal .rep-head{border-bottom:2.5px solid var(--majorelle);padding-bottom:14px;margin-bottom:20px}
.edl-report-portal .rep-head .kicker{font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--majorelle)}
.edl-report-portal .rep-head h1{font-family:var(--display);font-weight:800;font-size:23px;letter-spacing:-.02em;margin:7px 0 4px;line-height:1.14}
.edl-report-portal .rep-head p{margin:0;font-size:12px;color:var(--ink-60)}
.edl-report-portal .rep-sec{margin:22px 0 0;page-break-inside:auto}
.edl-report-portal .rep-sec > h2{
  font-family:var(--display);font-size:13.5px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;
  margin:0 0 9px;padding-bottom:5px;border-bottom:1px solid var(--line)
}
.edl-report-portal .rep-sec > h2 .n{font-family:var(--mono);color:var(--majorelle);margin-right:8px;font-size:12px}
.edl-report-portal table.rep{width:100%;border-collapse:collapse;font-size:11.5px}
.edl-report-portal table.rep th{
  text-align:left;font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-60);border-bottom:1px solid var(--ink);padding:5px 6px;font-weight:500
}
.edl-report-portal table.rep td{border-bottom:1px solid #EDEBE4;padding:6px;vertical-align:top}
.edl-report-portal table.rep tr{page-break-inside:avoid}
.edl-report-portal table.rep td.c{font-family:var(--mono);font-size:10px;color:var(--ink-60);white-space:nowrap}
.edl-report-portal table.rep td.e{white-space:nowrap;font-weight:600;font-size:10.5px}
.edl-report-portal .e-ok{color:var(--pine)}
.edl-report-portal .e-mid{color:var(--saffron)}
.edl-report-portal .e-bad{color:var(--brick)}
.edl-report-portal .e-na{color:var(--ink-30)}
.edl-report-portal .rep-ref{font-family:var(--mono);font-size:9px;color:var(--majorelle)}
.edl-report-portal .rep-room{color:#9A9CB0;font-size:10px}
.edl-report-portal .rep-dash{color:#C6C4BB}
.edl-report-portal .rep-note{font-size:11.5px;color:var(--ink-60);margin-top:14px}
.edl-report-portal .rep-missing{font-size:10.5px;color:var(--saffron);margin-top:9px}
.edl-report-portal .rep-gen{font-size:11.5px;white-space:pre-wrap}
.edl-report-portal .rep-gen-t{font-family:var(--display);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 6px}
.edl-report-portal .pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.edl-report-portal .pgrid figure{margin:0;page-break-inside:avoid}
.edl-report-portal .pgrid img{width:100%;height:132px;object-fit:cover;border:1px solid var(--line);display:block}
.edl-report-portal .pgrid figcaption{font-family:var(--mono);font-size:8.5px;color:var(--ink-60);margin-top:3px;line-height:1.3}
.edl-report-portal .idcard{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line);font-size:12px}
.edl-report-portal .idcard div{padding:8px 11px;border-bottom:1px solid var(--line)}
.edl-report-portal .idcard div:nth-child(odd){background:#FAF9F6;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-60)}
.edl-report-portal .kpis{display:flex;gap:0;border:1px solid var(--line);margin:14px 0 0}
.edl-report-portal .kpis div{flex:1;padding:11px 13px;border-right:1px solid var(--line)}
.edl-report-portal .kpis div:last-child{border-right:0}
.edl-report-portal .kpis b{display:block;font-family:var(--display);font-size:22px;font-weight:800;letter-spacing:-.02em}
.edl-report-portal .kpis span{font-family:var(--mono);font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-60)}
.edl-report-portal .sigs{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:14px;page-break-inside:avoid}
.edl-report-portal .sigs .s{border:1px solid var(--line);padding:12px;min-height:172px}
.edl-report-portal .sigs .s .who{font-weight:600;font-size:12.5px;margin-bottom:2px}
.edl-report-portal .sigs .s .role{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-60);margin-bottom:9px}
.edl-report-portal .sigs .s .mention{font-size:10.5px;color:var(--ink-60);margin-bottom:6px}
.edl-report-portal .sigs .s img{max-width:100%;max-height:88px;display:block}
.edl-report-portal .sigs .s .ruleline{border-bottom:1px dotted var(--ink-30);height:74px}
.edl-report-portal .paraphe{
  margin-top:26px;padding-top:8px;border-top:1px solid var(--line);
  font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:var(--ink-30);
  display:flex;justify-content:space-between
}
.edl-report-portal .legal{font-size:10px;color:var(--ink-60);line-height:1.55;margin-top:16px;border-top:1px solid var(--line);padding-top:10px}
.edl-report-portal .reportbar{
  position:sticky;top:0;z-index:70;background:var(--ink);color:#fff;padding:10px 14px;
  display:flex;gap:8px;justify-content:center;flex-wrap:wrap
}
.edl-report-portal .reportbar .btn.ghost{color:#fff;border-color:#3A3D5A}

@media (max-width:640px){
  .edl .item{grid-template-columns:44px 1fr}
  .edl-report-portal .sheet{padding:20px 16px}
  .edl-report-portal .sigs,.edl-report-portal .idcard{grid-template-columns:1fr}
  .edl-report-portal .pgrid{grid-template-columns:repeat(2,1fr)}
  .edl .actionbar .stats{gap:12px}
}
@media (prefers-reduced-motion:reduce){.edl *,.edl-report-portal *{transition:none!important}}

/* ---------- Liste des dossiers ---------- */
.edl .dossiers{width:100%;border-collapse:collapse;font-size:13.5px}
.edl .dossiers th{
  text-align:left;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-60);border-bottom:1px solid var(--ink);padding:7px 8px;font-weight:500;white-space:nowrap
}
.edl .dossiers td{border-bottom:1px solid #EDEBE4;padding:9px 8px;vertical-align:middle}
.edl .dossiers tr.row{cursor:pointer}
.edl .dossiers tr.row:hover td{background:#FAF9F6}
.edl .dossiers .t{font-weight:600}
.edl .dossiers .a{font-size:12px;color:var(--ink-60)}
.edl .dossiers .num{font-family:var(--mono);font-size:12px;color:var(--ink-60);white-space:nowrap}
.edl .dossiers .del{
  border:1px solid var(--line);background:#fff;color:var(--brick);border-radius:var(--radius);
  padding:4px 9px;font-size:12px;cursor:pointer
}
.edl .dossiers .del:hover{border-color:var(--brick)}
.edl .tag{
  display:inline-block;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
  padding:3px 8px;border-radius:100px;white-space:nowrap
}
.edl .tag.entree{background:var(--majorelle-soft);color:var(--majorelle)}
.edl .tag.sortie{background:#FBF3E2;color:#6A5310}
.edl .tag.brouillon{background:#F0EEE7;color:var(--ink-60)}
.edl .tag.archive{background:#E4F1EA;color:var(--pine)}
.edl .empty{padding:26px 4px;text-align:center;color:var(--ink-60);font-size:13.5px}
.edl .banner{
  font-size:13px;padding:10px 13px;border-radius:var(--radius);margin:0 0 14px;
  border-left:3px solid var(--saffron);background:#FBF3E2;color:#6A5310
}
.edl .banner.info{border-left-color:var(--majorelle);background:var(--majorelle-soft);color:var(--ink-60)}
.edl .banner.err{border-left-color:var(--brick);background:#F7E8E4;color:#7A2E1E}
.edl .sync{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8E90A8}

/* ---------- Impression : seul le rapport sort ---------- */
@media print{
  @page{size:A4;margin:13mm 12mm}
  body.edl-printing{background:#fff!important}
  body.edl-printing > *:not(.edl-report-portal){display:none!important}
  .edl-report-portal{position:static!important;background:#fff!important;padding:0!important;overflow:visible!important}
  .edl-report-portal .reportbar{display:none!important}
  .edl-report-portal .sheet{box-shadow:none;margin:0;padding:0;max-width:none}
  .edl-report-portal .rep-sec{page-break-inside:auto}
  .edl-report-portal .page-break{page-break-before:always}
  .edl-report-portal .pgrid img{height:118px}
}
`;

/* ============ Utilitaires ============ */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Un dossier peut venir d'un export ancien ou tronqué : on garantit la forme
// {s,o,v,p[]} pour que le rendu ne casse jamais sur un champ manquant.
function normalizeItems(raw) {
  const out = {};
  for (const k in (raw || {})) {
    const d = raw[k] || {};
    out[k] = { s:d.s ?? null, o:d.o ?? "", v:d.v ?? "", p:Array.isArray(d.p) ? d.p : [] };
  }
  return out;
}

function useGoogleFonts() {
  useEffect(() => {
    if (document.querySelector(`link[data-edl-fonts]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    link.setAttribute("data-edl-fonts", "1");
    document.head.appendChild(link);
  }, []);
}

/* ============ Bloc signature ============ */
function SignaturePad({ role, who, value, onChange, readOnly = false }) {
  const cvRef = useRef(null);
  const drawing = useRef(false);
  const painted = useRef(null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#15172B";
  }, []);

  // Ne repeint que si la valeur vient de l'extérieur (ouverture d'un dossier,
  // effacement) : sinon on effacerait le trait qu'on vient tout juste de faire.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv || value === painted.current) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (value) {
      const im = new Image();
      im.onload = () => ctx.drawImage(im, 0, 0, cv.width, cv.height);
      im.src = value;
    }
    painted.current = value;
  }, [value]);

  const pos = (e) => {
    const cv = cvRef.current;
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
  };

  const onDown = (e) => {
    const cv = cvRef.current;
    drawing.current = true;
    cv.setPointerCapture(e.pointerId);
    const ctx = cv.getContext("2d");
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const onMove = (e) => {
    if (!drawing.current) return;
    const ctx = cvRef.current.getContext("2d");
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const url = cvRef.current.toDataURL("image/png");
    painted.current = url;
    onChange(url);
  };
  const clear = () => {
    const cv = cvRef.current;
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    painted.current = null;
    onChange(null);
  };

  return (
    <div className="sigbox">
      <div className="lab">
        <span>{role}</span>
        {!readOnly && <button type="button" onClick={clear}>Effacer</button>}
      </div>
      <canvas
        ref={cvRef} width={600} height={260}
        style={readOnly ? { cursor:"default", touchAction:"auto" } : undefined}
        onPointerDown={readOnly ? undefined : onDown}
        onPointerMove={readOnly ? undefined : onMove}
        onPointerUp={readOnly ? undefined : end}
        onPointerLeave={readOnly ? undefined : end}
      />
      <div className="who">{who || ""}</div>
    </div>
  );
}

/* ============ Rapport imprimable ============ */
function Rapport({ meta, general, sigs, refEntree, getIt, photosPour, onBack }) {
  useEffect(() => {
    document.body.classList.add("edl-printing");
    return () => document.body.classList.remove("edl-printing");
  }, []);

  const done     = ALL_ITEMS.filter(x => getIt(x.item.c).s).length;
  const photos   = ALL_ITEMS.reduce((a, x) => a + photosPour(x.item.c).length, 0);
  const reserves = ALL_ITEMS.filter(x => RESERVE.has(getIt(x.item.c).s));
  const missing  = ALL_ITEMS.filter(x => !getIt(x.item.c).s);
  const dstr = meta.date
    ? new Date(meta.date + "T12:00").toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" })
    : "—";

  const sigBlock = (role, who, img, key) => (
    <div className="s" key={key}>
      <div className="who">{who || "—"}</div>
      <div className="role">{role}</div>
      <div className="mention">Mention manuscrite : « Lu et approuvé »</div>
      {img ? <img src={img} alt="Signature"/> : <div className="ruleline"/>}
    </div>
  );

  const n = ROOMS.length;

  return (
    <div className="edl-report-portal">
      <div className="reportbar">
        <button className="btn ghost" onClick={onBack}>Revenir à la saisie</button>
        <button className="btn primary" onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
      </div>

      <div className="sheet">
        <div className="rep-head">
          <div className="kicker">Annexe au contrat de bail à usage d'habitation meublée · Loi n° 67-12</div>
          <h1>
            État des lieux contradictoire {meta.type === "SORTIE" ? "de sortie" : "d'entrée"}<br/>
            et inventaire photographique
          </h1>
          <p>{meta.adresse} — établi le {dstr}{meta.heure ? ` à ${meta.heure}` : ""}</p>
        </div>

        <div className="idcard">
          <div>Bailleur</div><div>{meta.bailleur}</div>
          <div>Locataires solidaires</div>
          <div>{meta.loc1}{meta.loc2 ? <><br/>{meta.loc2}</> : null}</div>
          <div>Bien loué</div><div>{meta.adresse}</div>
          <div>Composition</div><div>{meta.surface}</div>
          <div>Date et heure</div><div>{dstr}{meta.heure ? " — " + meta.heure : ""}</div>
          <div>Tiers présents</div><div>{meta.tiers || "Aucun"}</div>
        </div>

        <div className="kpis">
          <div><b>{ALL_ITEMS.length}</b><span>Éléments inventoriés</span></div>
          <div><b>{done}</b><span>Éléments constatés</span></div>
          <div><b>{photos}</b><span>Photos annexées</span></div>
          <div><b>{reserves.length}</b><span>Réserves</span></div>
        </div>

        <p className="rep-note">
          Le présent document est dressé contradictoirement entre les parties, en leur présence, lors de la remise des
          clés. Il fait partie intégrante du contrat de bail signé à Marrakech et sert de référence unique pour la
          comparaison en fin de location. Les photographies annexées sont réputées prises le jour de l'établissement du
          présent état des lieux.
        </p>

        {ROOMS.map((r, ri) => {
          const pics = r.items.flatMap(i => {
            const ph = photosPour(i.c);
            return ph.map((src, k) => (
              <figure key={`${i.c}-${k}`}>
                <img src={src} alt=""/>
                <figcaption>{i.c} · {i.l.slice(0, 58)} — {k + 1}/{ph.length}</figcaption>
              </figure>
            ));
          });
          return (
            <section className="rep-sec" key={r.id}>
              <h2><span className="n">{String(ri + 1).padStart(2, "0")}</span>{r.name}</h2>
              <table className="rep">
                <thead>
                  <tr>
                    <th style={{width:52}}>Code</th>
                    <th>Désignation</th>
                    <th style={{width:56}}>Qté</th>
                    <th style={{width:88}}>État</th>
                    <th style={{width:"32%"}}>Observations contradictoires</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map(i => {
                    const d = getIt(i.c);
                    const rEnt = refEntree?.[i.c]?.s;
                    return (
                      <tr key={i.c}>
                        <td className="c">{i.c}</td>
                        <td>
                          {i.l}{i.q ? <span className="rep-room"> (×{i.q})</span> : null}
                          {rEnt ? <div className="rep-ref">Entrée : {STATE_LABEL[rEnt]}</div> : null}
                        </td>
                        <td className="c">{d.v || (i.q ? i.q : "—")}</td>
                        <td className={`e ${CLS[d.s] || "e-na"}`}>{d.s ? STATE_LABEL[d.s] : "Non renseigné"}</td>
                        <td>{d.o || <span className="rep-dash">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pics.length ? <div className="pgrid">{pics}</div> : null}
            </section>
          );
        })}

        <section className="rep-sec page-break">
          <h2><span className="n">{String(n + 1).padStart(2, "0")}</span>Synthèse des réserves</h2>
          {reserves.length ? (
            <table className="rep">
              <thead>
                <tr>
                  <th style={{width:52}}>Code</th>
                  <th>Élément</th>
                  <th style={{width:88}}>État</th>
                  <th style={{width:"40%"}}>Observation</th>
                </tr>
              </thead>
              <tbody>
                {reserves.map(x => {
                  const d = getIt(x.item.c);
                  return (
                    <tr key={x.item.c}>
                      <td className="c">{x.item.c}</td>
                      <td>{x.item.l}<div className="rep-room">{x.room.name}</div></td>
                      <td className="e e-bad">{STATE_LABEL[d.s]}</td>
                      <td>{d.o || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p style={{fontSize:11.5}}>
              Aucune réserve n'a été formulée par les parties sur l'état ou la présence des éléments inventoriés.
            </p>
          )}
          {missing.length ? (
            <p className="rep-missing">
              {missing.length} élément(s) non renseigné(s) au moment de l'édition : {missing.map(x => x.item.c).join(", ")}.
            </p>
          ) : null}
          {general ? (
            <>
              <h3 className="rep-gen-t">Observations générales</h3>
              <p className="rep-gen">{general}</p>
            </>
          ) : null}
        </section>

        <section className="rep-sec">
          <h2><span className="n">{String(n + 2).padStart(2, "0")}</span>Validation et signatures</h2>
          <p style={{fontSize:11, color:"#5A5C74"}}>
            Chaque page du présent document est paraphée par l'ensemble des parties contractantes. Les parties
            reconnaissent avoir visité le logement ensemble, vérifié le fonctionnement des équipements listés et accepté
            les constats ci-dessus.
          </p>
          <div className="sigs">
            {sigBlock("Le bailleur", meta.bailleur, sigs.b, "b")}
            {sigBlock("Locataire solidaire", meta.loc1, sigs.l1, "l1")}
            {meta.loc2 ? sigBlock("Locataire solidaire", meta.loc2, sigs.l2, "l2") : null}
            {meta.tiers ? sigBlock("Tiers présent", meta.tiers, null, "t") : null}
          </div>
          <p className="legal">
            Fait à Marrakech, le {dstr}, en autant d'exemplaires originaux que de parties, chacune reconnaissant avoir
            reçu le sien avec ses annexes photographiques. À défaut d'état des lieux de sortie contradictoire, la
            comparaison se fera sur la base du présent document. Les éventuelles dégradations constatées en fin de bail
            s'apprécient déduction faite de l'usure normale liée à l'usage du logement pendant la durée de la location.
          </p>
          <div className="paraphe">
            <span>Initiales bailleur : ______________</span>
            <span>Initiales locataires : ______________</span>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============ Saisie d'un état des lieux ============ */
function SaisieEDL({ dossier, profil, onRetour }) {
  const archive = dossier.statut === "archive";
  const d0 = dossier.donnees || {};

  const [meta, setMeta]         = useState(() => ({ ...DEFAULT_META, ...(d0.meta || {}) }));
  const [items, setItems]       = useState(() => normalizeItems(d0.items));
  const [general, setGeneral]   = useState(() => d0.general || "");
  const [sigs, setSigs]         = useState(() => d0.sigs || { b:null, l1:null, l2:null });
  const [refEntree, setRefEntree] = useState(() => (d0.ref ? normalizeItems(d0.ref) : null));
  const [current, setCurrent]   = useState(ROOMS[0].id);
  const [reportMode, setReportMode] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // Photos du brouillon : locales à l'appareil (IndexedDB), jamais envoyées
  // tant que le rapport n'est pas archivé. { code: [{id, dataUrl}] }
  const [photosLocales, setPhotosLocales] = useState({});
  // Rapport archivé : chemins Storage → URLs signées.
  const [urlsSignees, setUrlsSignees] = useState({});
  const [sync, setSync]         = useState("");
  const [erreur, setErreur]     = useState("");
  const [archivage, setArchivage] = useState(null); // {fait, total} pendant l'envoi

  const scrollRef  = useRef(null);
  const photoInput = useRef(null);
  const photoTarget = useRef(null);
  const toastTimer = useRef(null);
  const saveTimer  = useRef(null);
  const premierRendu = useRef(true);

  const getIt = useCallback((c) => items[c] || EMPTY_ITEM, [items]);

  const patchItem = useCallback((c, patch) => {
    setItems(prev => ({ ...prev, [c]: { ...(prev[c] || EMPTY_ITEM), ...patch } }));
  }, []);

  const toast = useCallback((t) => {
    setToastMsg(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2200);
  }, []);

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(saveTimer.current); }, []);

  // Chargement des photos : IndexedDB pour un brouillon, URLs signées pour un
  // rapport déjà archivé.
  useEffect(() => {
    let annule = false;
    if (archive) {
      signerPhotos(dossier.donnees || {})
        .then(m => { if (!annule) setUrlsSignees(m); })
        .catch(e => { if (!annule) setErreur("Photos illisibles : " + (e.message || e)); });
    } else {
      idbList(dossier.id).then(p => { if (!annule) setPhotosLocales(p); });
    }
    return () => { annule = true; };
  }, [dossier.id, archive]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let done = 0, res = 0, photos = 0;
    for (const { item } of ALL_ITEMS) {
      const d = items[item.c] || EMPTY_ITEM;
      if (d.s) done++;
      if (RESERVE.has(d.s)) res++;
      photos += archive ? d.p.length : (photosLocales[item.c]?.length || 0);
    }
    return { done, res, photos, total: ALL_ITEMS.length };
  }, [items, photosLocales, archive]);

  // Photos à afficher pour un élément — même signature quel que soit l'étage
  // de stockage, pour que la saisie et le rapport n'aient pas à s'en soucier.
  const photosPour = useCallback((code) => {
    if (archive) return (items[code]?.p || []).map(p => urlsSignees[p]).filter(Boolean);
    return (photosLocales[code] || []).map(x => x.dataUrl);
  }, [archive, items, urlsSignees, photosLocales]);

  /* ---- Sauvegarde automatique de la saisie (sans les photos) ---- */
  // `enAttente` porte le dernier état non encore écrit. Il sert à deux choses :
  // la sauvegarde différée, et le rattrapage au démontage — sans quoi les
  // 1,2 s d'édition précédant un « ← Dossiers » partiraient à la poubelle.
  const enAttente = useRef(null);

  const ecrire = useCallback(async () => {
    const patch = enAttente.current;
    if (!patch) return;
    try {
      await majEDL(dossier.id, patch);
      if (enAttente.current === patch) enAttente.current = null;
      setSync("Enregistré");
      setErreur("");
    } catch (e) {
      setSync("");
      setErreur("Enregistrement impossible : " + (e.message || e));
    }
  }, [dossier.id]);

  useEffect(() => {
    if (archive) return;
    if (premierRendu.current) { premierRendu.current = false; return; }
    const light = {};
    for (const k in items) light[k] = { s:items[k].s, o:items[k].o, v:items[k].v, p:[] };
    enAttente.current = {
      donnees: { meta, items:light, general, sigs, ref:refEntree },
      type: meta.type,
      date_edl: meta.date || null,
      nb_elements: ALL_ITEMS.length,
      nb_renseignes: stats.done,
      nb_photos: stats.photos,
      nb_reserves: stats.res,
    };
    setSync("Modifications non enregistrées");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(ecrire, 1200);
  }, [meta, items, general, sigs, refEntree]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    if (!archive && enAttente.current) majEDL(dossier.id, enAttente.current).catch(() => {});
  }, [dossier.id, archive]);

  /* ---- Comparaison sortie / entrée ---- */
  // Sur un état des lieux de SORTIE, on peut rappeler en regard de chaque
  // élément ce qui avait été constaté à l'entrée. Remplace l'ancien import de
  // fichier .json : la référence se prend directement dans le dossier.
  const [entrees, setEntrees] = useState([]);
  useEffect(() => {
    if (archive || meta.type !== "SORTIE") { setEntrees([]); return; }
    let annule = false;
    listerEDL()
      .then(rs => { if (!annule) setEntrees(rs.filter(r => r.type === "ENTRÉE" && r.statut === "archive")); })
      .catch(() => {});
    return () => { annule = true; };
  }, [meta.type, archive]);

  const prendreReference = async (id) => {
    if (!id) { setRefEntree(null); return; }
    try {
      const row = await chargerEDL(id);
      setRefEntree(normalizeItems(row?.donnees?.items));
      toast("État des lieux d'entrée pris comme référence");
    } catch (e) {
      setErreur("Référence illisible : " + (e.message || e));
    }
  };

  /* ---- Photos ---- */
  const addPhotos = async (code, files) => {
    const list = [...files];
    if (!list.length) return;
    let ok = 0;
    for (const f of list) {
      try {
        const src = await fichierVersDataUrl(f);
        // 1400 px : confortable à l'écran. La réduction pour l'archivage
        // (1000 px) n'a lieu qu'au moment de figer le rapport.
        const dataUrl = await recompresser(src, 1400, 0.72, "dataUrl");
        const id = await idbAdd(dossier.id, code, dataUrl);
        setPhotosLocales(prev => ({ ...prev, [code]: [...(prev[code] || []), { id, dataUrl }] }));
        ok++;
      } catch { /* photo ignorée, on continue les suivantes */ }
    }
    toast(ok ? `${ok} photo(s) ajoutée(s)` : "Photo illisible");
  };

  const removePhoto = async (code, index) => {
    const photo = (photosLocales[code] || [])[index];
    if (photo?.id != null) await idbDelete(photo.id);
    setPhotosLocales(prev => ({ ...prev, [code]: (prev[code] || []).filter((_, k) => k !== index) }));
  };

  /* ---- Archivage : c'est ici, et seulement ici, que les photos partent ---- */
  const archiver = async () => {
    const nb = stats.photos;
    const ok = window.confirm(
      `Figer le rapport ?\n\n${nb} photo(s) vont être envoyées sur l'application et le dossier passera en lecture seule.\n\n`
      + `Le rapport restera consultable et imprimable à tout moment, mais la saisie ne sera plus modifiable.`
    );
    if (!ok) return;

    // Impératif : une sauvegarde différée encore en vol réécrirait `donnees`
    // avec p:[] APRÈS l'archivage et effacerait les chemins des photos.
    clearTimeout(saveTimer.current);
    enAttente.current = null;

    setArchivage({ fait:0, total:nb });
    setErreur("");
    try {
      const light = {};
      for (const k in items) light[k] = { s:items[k].s, o:items[k].o, v:items[k].v, p:[] };
      const base = { meta, items:light, general, sigs, ref:refEntree };

      const donnees = await archiverPhotos(dossier.id, base, photosLocales,
        (fait, total) => setArchivage({ fait, total }));

      await majEDL(dossier.id, {
        donnees,
        statut: "archive",
        type: meta.type,
        date_edl: meta.date || null,
        nb_elements: ALL_ITEMS.length,
        nb_renseignes: stats.done,
        nb_photos: nb,
        nb_reserves: stats.res,
        archive_le: new Date().toISOString(),
        auteur: profil?.nom || profil?.email || null,
      });

      await idbClear(dossier.id);
      setArchivage(null);
      toast("Rapport archivé");
      onRetour(true);
    } catch (e) {
      setArchivage(null);
      setErreur("Archivage interrompu : " + (e.message || e) + " — la saisie est intacte, vous pouvez réessayer.");
    }
  };

  // Garde-fou : les photos d'un brouillon vivent sur cet appareil uniquement.
  useEffect(() => {
    if (archive || !stats.photos) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [stats.photos, archive]);

  if (reportMode) {
    return createPortal(
      <>
        <style>{EDL_CSS}</style>
        <Rapport
          meta={meta} general={general} sigs={sigs} refEntree={refEntree}
          getIt={getIt} photosPour={photosPour} onBack={() => setReportMode(false)}
        />
      </>,
      document.body
    );
  }

  const room = ROOMS.find(r => r.id === current) || ROOMS[0];
  const isLast = ROOMS[ROOMS.length - 1].id === room.id;

  const goRoom = (id) => {
    setCurrent(id);
    scrollRef.current?.parentElement?.scrollTo?.({ top:0 });
    window.scrollTo({ top:0 });
  };

  return (
    <div className="edl" ref={scrollRef}>
      <style>{EDL_CSS}</style>

      <header className="masthead">
        <p className="eyebrow">
          Loi n° 67-12 · Bail meublé · {meta.type === "SORTIE" ? "État des lieux de sortie" : "État des lieux d'entrée"}
        </p>
        <h1>État des lieux contradictoire<br/><em>{dossier.titre}</em></h1>
        <p className="sub">
          {archive
            ? "Rapport archivé : lecture seule. Il reste consultable et imprimable à tout moment."
            : "Saisissez pièce par pièce, ajoutez les photos, puis archivez le rapport à signer."}
        </p>
      </header>

      <nav className="roomnav" role="tablist" aria-label="Pièces">
        {ROOMS.map(r => {
          const tot = r.items.length;
          const done = r.items.filter(i => getIt(i.c).s).length;
          return (
            <button key={r.id} type="button" className={`roomtab ${done === tot ? "done" : ""}`}
              role="tab" aria-selected={r.id === current} onClick={() => goRoom(r.id)}>
              {r.name} <span className="tick">{done === tot ? "✓" : `${done}/${tot}`}</span>
            </button>
          );
        })}
      </nav>

      <div className="wrap">
        {erreur && <p className="banner err">{erreur}</p>}
        {archivage && (
          <p className="banner">
            Envoi des photos en cours — {archivage.fait}/{archivage.total}. Ne fermez pas cet onglet.
          </p>
        )}
        {archive && (
          <p className="banner info">
            Ce rapport est figé{dossier.archive_le
              ? ` depuis le ${new Date(dossier.archive_le).toLocaleDateString("fr-FR")}`
              : ""}. La saisie n'est plus modifiable : c'est ce qui lui donne sa valeur de référence.
          </p>
        )}
        {!archive && stats.photos > 0 && (
          <p className="banner">
            {stats.photos} photo(s) sur cet appareil uniquement. Elles ne seront envoyées sur l'application
            qu'au moment d'archiver le rapport.
          </p>
        )}

        <section className="card">
          <div className="card-hd">
            <h2>Cadre du document</h2>
            <p className="hint">Ces informations ouvrent le rapport.</p>
          </div>
          <div className="card-bd">
            <div className="grid">
              {METAFIELDS.map(f => (
                <label className="f" key={f.k}>
                  <span>{f.label}</span>
                  {f.type === "select" ? (
                    <select value={meta[f.k]} disabled={archive}
                      onChange={e => setMeta(m => ({ ...m, [f.k]:e.target.value }))}>
                      <option value="ENTRÉE">Entrée</option>
                      <option value="SORTIE">Sortie</option>
                    </select>
                  ) : (
                    <input type={f.type || "text"} value={meta[f.k] || ""} disabled={archive}
                      onChange={e => setMeta(m => ({ ...m, [f.k]:e.target.value }))}/>
                  )}
                </label>
              ))}
            </div>

            {!archive && meta.type === "SORTIE" && (
              <div style={{ marginTop:14 }}>
                <label className="f">
                  <span>Comparer à l'état des lieux d'entrée</span>
                  <select defaultValue="" onChange={e => prendreReference(e.target.value)}>
                    <option value="">— Aucune référence —</option>
                    {entrees.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.titre} — {r.date_edl || "sans date"}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint" style={{ marginTop:6 }}>
                  {entrees.length
                    ? "L'état constaté à l'entrée s'affichera en regard de chaque élément, et dans le rapport."
                    : "Aucun état des lieux d'entrée archivé pour l'instant."}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-hd">
            <h2>{room.name}</h2>
            <p className="hint">{room.items.length} éléments</p>
          </div>
          <div className="card-bd">
            {room.note && <p className={`room-note ${room.warn ? "warn" : ""}`}>{room.note}</p>}

            {room.items.map(i => {
              const d = getIt(i.c);
              const rEnt = refEntree?.[i.c];
              return (
                <article className="item" key={i.c}>
                  <div className="rail">
                    <span className="code">{i.c}</span>
                    <span className="dot" style={{ background: d.s ? DOTCOL[d.s] : "#DEDBD1" }}/>
                  </div>
                  <div className="bd">
                    <h3>{i.l}</h3>
                    {i.q ? <span className="qty">Quantité annoncée : {i.q}</span> : null}
                    {rEnt?.s ? (
                      <div className="refline">
                        Entrée : {STATE_LABEL[rEnt.s] || "—"}{rEnt.o ? ` — ${rEnt.o}` : ""}
                      </div>
                    ) : null}

                    <div className="scale">
                      {STATES.map(s => (
                        <button key={s.k} type="button" data-s={s.k} aria-pressed={d.s === s.k} disabled={archive}
                          onClick={() => patchItem(i.c, { s: d.s === s.k ? null : s.k })}>
                          {s.l}
                        </button>
                      ))}
                    </div>

                    {i.f ? (
                      <div className="extra">
                        <label className="f">
                          <span>{i.f}</span>
                          <input type="text" value={d.v} disabled={archive}
                            onChange={e => patchItem(i.c, { v:e.target.value })}/>
                        </label>
                      </div>
                    ) : null}

                    <div className="obs">
                      <textarea value={d.o} disabled={archive}
                        onChange={e => patchItem(i.c, { o:e.target.value })}
                        placeholder="Observations : rayure, tache, jeu, fuite, fonctionnement testé…"/>
                    </div>

                    <div className="photos">
                      {photosPour(i.c).map((src, n) => (
                        <div className="thumb" key={n}>
                          <img src={src} alt={`Photo ${n + 1} de ${i.l}`}/>
                          {!archive && (
                            <button type="button" aria-label="Supprimer la photo"
                              onClick={() => removePhoto(i.c, n)}>×</button>
                          )}
                        </div>
                      ))}
                      {!archive && (
                        <button type="button" className="addphoto" onClick={() => {
                          photoTarget.current = i.c;
                          photoInput.current.value = "";
                          photoInput.current.click();
                        }}>
                          <span className="plus">+</span>PHOTO
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            <div className="rowbtns">
              {!archive && (
                <button className="btn ghost sm" type="button" onClick={() => {
                  setItems(prev => {
                    const next = { ...prev };
                    room.items.forEach(i => {
                      const d = next[i.c] || EMPTY_ITEM;
                      if (!d.s) next[i.c] = { ...d, s:"BON" };
                    });
                    return next;
                  });
                  toast("Éléments restants marqués « Bon »");
                }}>
                  Marquer les éléments restants « Bon »
                </button>
              )}
              {!isLast && (
                <button className="btn sm" type="button" onClick={() => {
                  const idx = ROOMS.findIndex(x => x.id === current);
                  goRoom(ROOMS[idx + 1].id);
                }}>
                  Pièce suivante →
                </button>
              )}
            </div>
          </div>
        </section>

        {isLast && (
          <>
            <section className="card">
              <div className="card-hd">
                <h2>Observations générales et réserves</h2>
                <p className="hint">Texte repris en fin de rapport.</p>
              </div>
              <div className="card-bd">
                <textarea value={general} disabled={archive} onChange={e => setGeneral(e.target.value)}
                  placeholder="Réserves globales, points à reprendre par le bailleur, délais convenus…"/>
              </div>
            </section>

            <section className="card">
              <div className="card-hd">
                <h2>Signatures</h2>
                <p className="hint">
                  Signez au doigt ou à la souris. La mention manuscrite « Lu et approuvé » reste à porter sur
                  l'exemplaire papier.
                </p>
              </div>
              <div className="card-bd">
                <div className="grid">
                  <SignaturePad role="Le bailleur" who={meta.bailleur} value={sigs.b} readOnly={archive}
                    onChange={v => setSigs(s => ({ ...s, b:v }))}/>
                  <SignaturePad role="Locataire 1" who={meta.loc1} value={sigs.l1} readOnly={archive}
                    onChange={v => setSigs(s => ({ ...s, l1:v }))}/>
                  <SignaturePad role="Locataire 2" who={meta.loc2} value={sigs.l2} readOnly={archive}
                    onChange={v => setSigs(s => ({ ...s, l2:v }))}/>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <div className="actionbar">
        <div className="stats">
          <div><span className="lab">Renseignés</span><b>{stats.done}/{stats.total}</b></div>
          <div><span className="lab">Photos</span><b>{stats.photos}</b></div>
          <div className="reserves"><span className="lab">Réserves</span><b>{stats.res}</b></div>
          {!archive && sync && (
            <div style={{ alignSelf:"center" }}><span className="sync">{sync}</span></div>
          )}
        </div>
        <div className="acts">
          <button className="btn ghost sm" type="button" onClick={() => onRetour(false)}>← Dossiers</button>
          <button className="btn ghost sm" type="button" onClick={() => setReportMode(true)}>
            {archive ? "Voir le rapport" : "Aperçu du rapport"}
          </button>
          {!archive && (
            <button className="btn primary" type="button" onClick={archiver} disabled={!!archivage}>
              {archivage
                ? `Envoi ${archivage.fait}/${archivage.total}…`
                : "Archiver le rapport"}
            </button>
          )}
        </div>
      </div>

      <div className={`toast ${toastMsg ? "show" : ""}`}>{toastMsg}</div>

      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={e => addPhotos(photoTarget.current, e.target.files)}/>
    </div>
  );
}

/* ============ Liste des dossiers ============ */
const NOUVEAU_VIDE = { titre:"", adresse:"", type:"ENTRÉE", date_edl:todayISO() };

function ListeEDL({ profil, onOuvrir }) {
  const [rows, setRows]       = useState(null);   // null = chargement en cours
  const [erreur, setErreur]   = useState("");
  const [form, setForm]       = useState(null);   // null = formulaire fermé
  const [creation, setCreation] = useState(false);

  const recharger = useCallback(() => {
    listerEDL()
      .then(r => { setRows(r); setErreur(""); })
      .catch(e => {
        setRows([]);
        setErreur(
          /relation .* does not exist|schema cache/i.test(e.message || "")
            ? "La table invest_etats_des_lieux n'existe pas encore : exécutez sql/202608_invest_etats_des_lieux.sql dans l'éditeur SQL Supabase."
            : "Chargement impossible : " + (e.message || e)
        );
      });
  }, []);

  useEffect(() => { recharger(); }, [recharger]);

  const creer = async () => {
    if (!form.titre.trim()) return;
    setCreation(true);
    try {
      const row = await creerEDL({
        titre: form.titre.trim(),
        adresse: form.adresse.trim() || null,
        type: form.type,
        date_edl: form.date_edl || null,
        statut: "brouillon",
        auteur: profil?.nom || profil?.email || null,
        donnees: {
          meta: {
            ...DEFAULT_META,
            type: form.type,
            date: form.date_edl || "",
            adresse: form.adresse.trim() || DEFAULT_META.adresse,
          },
          items: {}, general:"", sigs:{ b:null, l1:null, l2:null },
        },
        nb_elements: ALL_ITEMS.length,
      });
      setForm(null);
      onOuvrir(row);
    } catch (e) {
      setErreur("Création impossible : " + (e.message || e));
    } finally {
      setCreation(false);
    }
  };

  const supprimer = async (row, e) => {
    e.stopPropagation();
    const ok = window.confirm(
      `Supprimer « ${row.titre} » ?\n\n`
      + (row.statut === "archive"
          ? `Le rapport archivé et ses ${row.nb_photos} photo(s) seront définitivement effacés.`
          : "Le brouillon sera définitivement effacé.")
      + "\n\nCette action est irréversible."
    );
    if (!ok) return;
    try {
      await supprimerEDL(row.id);
      recharger();
    } catch (err) {
      setErreur("Suppression impossible : " + (err.message || err));
    }
  };

  const fmtDate = (d) => d
    ? new Date(d + "T12:00").toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" })
    : "—";

  return (
    <div className="edl">
      <style>{EDL_CSS}</style>

      <header className="masthead">
        <p className="eyebrow">Loi n° 67-12 · Baux meublés · Profero Invest</p>
        <h1>Dossier des <em>états des lieux</em></h1>
        <p className="sub">
          Chaque état des lieux est enregistré sur l'application. Une fois archivé, son rapport et ses photos
          restent consultables et imprimables à tout moment, depuis n'importe quel poste.
        </p>
      </header>

      <div className="wrap">
        {erreur && <p className="banner err">{erreur}</p>}

        <section className="card">
          <div className="card-hd">
            <h2>États des lieux</h2>
            <p className="hint">{rows ? `${rows.length} dossier(s)` : "Chargement…"}</p>
            <div style={{ marginLeft:"auto" }}>
              <button className="btn primary sm" type="button"
                onClick={() => setForm(form ? null : { ...NOUVEAU_VIDE })}>
                {form ? "Annuler" : "+ Nouvel état des lieux"}
              </button>
            </div>
          </div>

          {form && (
            <div className="card-bd" style={{ borderBottom:"1px solid var(--line)" }}>
              <div className="grid">
                <label className="f"><span>Intitulé du dossier</span>
                  <input type="text" autoFocus value={form.titre} placeholder="Résidence Al Hana — Apt 16"
                    onChange={e => setForm(f => ({ ...f, titre:e.target.value }))}/></label>
                <label className="f"><span>Adresse du bien</span>
                  <input type="text" value={form.adresse} placeholder="Guéliz, 40000 Marrakech"
                    onChange={e => setForm(f => ({ ...f, adresse:e.target.value }))}/></label>
                <label className="f"><span>Type</span>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type:e.target.value }))}>
                    <option value="ENTRÉE">Entrée</option>
                    <option value="SORTIE">Sortie</option>
                  </select></label>
                <label className="f"><span>Date</span>
                  <input type="date" value={form.date_edl}
                    onChange={e => setForm(f => ({ ...f, date_edl:e.target.value }))}/></label>
              </div>
              <div className="rowbtns">
                <button className="btn" type="button" onClick={creer} disabled={!form.titre.trim() || creation}>
                  {creation ? "Création…" : "Créer et commencer la saisie"}
                </button>
              </div>
            </div>
          )}

          <div className="card-bd">
            {!rows ? (
              <p className="empty">Chargement des dossiers…</p>
            ) : rows.length === 0 ? (
              <p className="empty">
                Aucun état des lieux pour l'instant.<br/>
                Cliquez sur « + Nouvel état des lieux » pour créer le premier.
              </p>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table className="dossiers">
                  <thead>
                    <tr>
                      <th>Dossier</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>État</th>
                      <th>Saisie</th>
                      <th>Photos</th>
                      <th>Réserves</th>
                      <th/>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="row" onClick={() => onOuvrir(r)}>
                        <td>
                          <div className="t">{r.titre}</div>
                          {r.adresse && <div className="a">{r.adresse}</div>}
                        </td>
                        <td><span className={`tag ${r.type === "SORTIE" ? "sortie" : "entree"}`}>
                          {r.type === "SORTIE" ? "Sortie" : "Entrée"}</span></td>
                        <td className="num">{fmtDate(r.date_edl)}</td>
                        <td><span className={`tag ${r.statut === "archive" ? "archive" : "brouillon"}`}>
                          {r.statut === "archive" ? "Archivé" : "Brouillon"}</span></td>
                        <td className="num">{r.nb_renseignes}/{r.nb_elements || ALL_ITEMS.length}</td>
                        <td className="num">{r.nb_photos}</td>
                        <td className="num">{r.nb_reserves}</td>
                        <td style={{ textAlign:"right" }}>
                          <button className="del" type="button" onClick={e => supprimer(r, e)}>Supprimer</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <p className="banner info">
          Pendant la saisie, les photos restent sur l'appareil qui les prend — elles ne partent sur l'application
          qu'au moment d'archiver le rapport, pour ne pas encombrer le stockage avec des brouillons. La saisie
          elle-même (états, observations, quantités) est synchronisée en continu et se reprend depuis un autre poste.
        </p>
      </div>
    </div>
  );
}

/* ============ Page ============ */
export default function EtatDesLieux({ profil }) {
  useGoogleFonts();
  const [dossier, setDossier] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  // La liste ne rapatrie pas la colonne `donnees` (lourde) : on la charge à
  // l'ouverture du dossier.
  const ouvrir = async (row) => {
    setChargement(true);
    setErreur("");
    try {
      setDossier(await chargerEDL(row.id));
    } catch (e) {
      setErreur("Ouverture impossible : " + (e.message || e));
    } finally {
      setChargement(false);
    }
  };

  if (chargement) {
    return (
      <div className="edl">
        <style>{EDL_CSS}</style>
        <div className="wrap"><p className="empty">Ouverture du dossier…</p></div>
      </div>
    );
  }

  if (dossier) {
    return (
      <SaisieEDL
        key={dossier.id}
        dossier={dossier}
        profil={profil}
        onRetour={() => setDossier(null)}
      />
    );
  }

  return (
    <>
      {erreur && (
        <div className="edl">
          <style>{EDL_CSS}</style>
          <div className="wrap"><p className="banner err">{erreur}</p></div>
        </div>
      )}
      <ListeEDL profil={profil} onOuvrir={ouvrir}/>
    </>
  );
}
