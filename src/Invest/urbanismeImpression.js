import {
  URBA_NATURES, URBA_PIECES, urbaExigences, urbaCompletude, urbaRetroplanning,
  urbaArchitecte, urbaLignesFacade, urbaTotal, urbaFmtDate, urbaStatut,
  urbaDivisionConcernee, urbaFacadeConcernee, urbaSurfacesConcernees,
  urbaStationnementConcerne, urbaSocieteExistante, urbaPieceStatut,
  URBA_REGLE_COMMERCIALE,
} from "./urbanismeStore";

// ─────────────────────────────────────────────────────────────────────────────
// Impression de la FDU.
//
// La fiche imprimée est le document que reçoit le pôle urbanisme et qui part au
// dossier du chantier : elle reprend les dix blocs, la checklist des pièces et
// le rétroplanning calculé. Charte papier volontairement sobre (noir sur blanc,
// pas de thème sombre) : ça se relit à la main et ça s'annote.
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const val = (v) => { const t = String(v ?? "").trim(); return t ? esc(t) : '<span class="vide">—</span>'; };
const oui = (v) => (v === true ? "Oui" : v === false ? "Non" : v);

// Tableau « champ / valeur » — la forme de tous les blocs de la FDU.
const lignes = (paires) => paires
  .map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + val(oui(v)) + '</td></tr>')
  .join("");

const bloc = (titre, corps) =>
  '<section class="bloc"><h2>' + esc(titre) + '</h2>' + corps + '</section>';

const tableauCV = (paires) => '<table class="cv">' + lignes(paires) + '</table>';

function tableau(entetes, rangs) {
  if (!rangs.length) return '<p class="vide">Aucune ligne renseignée.</p>';
  return '<table class="grille"><thead><tr>'
    + entetes.map(h => '<th>' + esc(h) + '</th>').join("")
    + '</tr></thead><tbody>'
    + rangs.map(r => '<tr>' + r.map(c => '<td>' + val(c) + '</td>').join("") + '</tr>').join("")
    + '</tbody></table>';
}

// `pagesAnnexes` : pages prêtes à insérer, [{ piece, nom, url, page, total }].
// Les images y sont sous leur URL signée, les PDF sous forme de data URL — une
// entrée par page — produites par l'appelant via pdf.js.
//
// `annexesIgnorees` : [{ piece, nom, raison }], ce qui n'a pas pu être rendu.
// On l'imprime au lieu de le taire : une pièce absente du dossier doit se voir.
//
// Les deux sont optionnels : sans eux la FDU s'imprime seule, l'appelant n'a pas
// deux chemins de code à tenir.
export function imprimerFDU(row, { pagesAnnexes = [], annexesIgnorees = [] } = {}) {
  const d = row?.donnees || {};
  const id = d.identification || {};
  const dem = d.demandeur || {};
  const b = d.bien || {};
  const nat = d.nature || {};
  const c = urbaCompletude(d);
  const retro = urbaRetroplanning({ ...d, _statut:row?.statut });
  const arch = urbaArchitecte(d);
  const st = urbaStatut(row?.statut);

  const naturesLabels = (nat.natures || [])
    .map(n => URBA_NATURES.find(x => x.id === n)?.label || n)
    .join(" · ");

  const corps = [];

  corps.push(bloc("Bloc 1 — Identification de la demande", tableauCV([
    ["N° de dossier / référence chantier", id.reference],
    ["Entité concernée", id.entite],
    ["Commercial demandeur", id.commercial],
    ["Date de la demande", urbaFmtDate(id.date_demande)],
    ["Date maximum de dépôt", urbaFmtDate(id.date_max_depot)],
    ["Origine de la contrainte de date", id.origine_contrainte === "Autre" ? id.origine_autre : id.origine_contrainte],
    ["Date prévisionnelle de signature notaire", urbaFmtDate(id.date_notaire)],
    ["Date prévisionnelle démarrage travaux", urbaFmtDate(id.date_travaux)],
    ["Le client est-il déjà propriétaire ?", id.deja_proprietaire],
  ])));

  const s = dem.societe || {}, f = dem.futur || {};
  corps.push(bloc("Bloc 2 — Le demandeur", urbaSocieteExistante(d)
    ? tableauCV([
        ["Situation", "Société existante"],
        ["Dénomination sociale", s.denomination],
        ["Forme juridique", s.forme],
        ["SIRET", s.siret],
        ["Adresse du siège social", s.adresse_siege],
        ["Représentant légal", s.representant],
        ["Qualité", s.qualite],
        ["Téléphone", s.telephone],
        ["Email", s.email],
      ])
    : tableauCV([
        ["Situation", "Société non encore créée"],
        ["Nom / prénom du futur dirigeant", f.nom],
        ["Date et lieu de naissance", [f.naissance_date ? urbaFmtDate(f.naissance_date) : "", f.naissance_lieu].filter(Boolean).join(" à ")],
        ["Adresse personnelle", f.adresse],
        ["Téléphone", f.telephone],
        ["Email", f.email],
        ["Date prévisionnelle d'immatriculation", urbaFmtDate(f.date_immatriculation)],
        ["Dépôt au nom du particulier avec transfert ultérieur ?", f.depot_particulier],
      ])));

  if (arch.obligatoire || arch.motif) {
    corps.push('<p class="vigilance"><strong>Point de vigilance — architecte :</strong> '
      + esc(arch.motif || "") + (arch.obligatoire
        ? " Le recours à un architecte est obligatoire : budget et délai du dossier impactés."
        : "") + '</p>');
  }

  const cadastre = (b.cadastre || []).filter(p => p?.section || p?.numero || p?.surface);
  corps.push(bloc("Bloc 3 — Le bien", tableauCV([
    ["Adresse complète", [b.adresse, b.code_postal, b.commune].filter(Boolean).join(", ")],
    ["Références cadastrales", cadastre.map(p => [p.section, p.numero, p.surface ? p.surface + " m²" : ""].filter(Boolean).join(" ")).join(" / ")],
    ["Zone PLU", b.zone_plu],
    ["Périmètre ABF / site patrimonial remarquable", b.abf],
    ["Bien en copropriété ?", b.copro + (b.copro_parties_communes ? " — travaux sur parties communes / façades" : "")],
    ["Bien occupé ou vacant", b.occupation],
    ["Servitudes connues", b.servitudes],
    ["Assainissement", b.assainissement],
    ["Contact sur place (photos / mesures)", [b.contact_nom, b.contact_tel].filter(Boolean).join(" — ")],
    ["Façade non visible depuis la rue", b.facade_non_visible ? "Oui — photos terrain indispensables" : "Non"],
  ])));

  corps.push(bloc("Bloc 4 — Nature de la demande", tableauCV([
    ["Nature(s) cochée(s)", naturesLabels],
    ["Précision « Autre »", nat.autre_precision],
    ["Autorisation retenue", nat.autorisation],
    ["PC maison individuelle", nat.pc_maison_individuelle ? "Oui" : "Non"],
  ])));

  if (urbaDivisionConcernee(d)) {
    const dv = d.division || {};
    const logs = (dv.logements || []).filter(g => g?.numero || g?.niveau || g?.typologie || g?.surface_habitable);
    corps.push(bloc("Bloc 5 — Division",
      tableauCV([
        ["Nombre de logements avant", dv.nb_avant],
        ["Nombre de logements après", dv.nb_apres],
        ["Type d'exploitation visé", dv.exploitation],
        ["Création de compteurs individuels", ["Eau : " + (dv.compteurs?.eau || "—"), "Élec : " + (dv.compteurs?.elec || "—"), "Gaz : " + (dv.compteurs?.gaz || "—")].join(" · ")],
        ["Accès aux logements", [dv.acces, dv.acces_precision].filter(Boolean).join(" — ")],
      ])
      + tableau(["N°", "Niveau", "Typologie", "Surface habitable", "Surface de plancher"],
        logs.map(g => [g.numero, g.niveau, g.typologie, g.surface_habitable, g.surface_plancher]))));
  }

  if (urbaFacadeConcernee(d)) {
    const lg = urbaLignesFacade(d);
    const fa = d.facade || {};
    corps.push(bloc("Bloc 6 — Modifications de façade et toiture",
      tableau(["N°", "Façade", "Niveau", "Pièce", "Existant", "Projeté", "L × H (cm)", "Matériau", "Couleur / RAL", "Type d'ouverture", "Modèle / réf."],
        lg.map((l, i) => [
          i + 1, l.facade, l.niveau, l.piece, l.existant, l.projete,
          [l.largeur, l.hauteur].filter(Boolean).join(" × "), l.materiau, l.couleur, l.type_ouverture, l.modele,
        ]))
      + tableauCV([
        ["Type de vitrage", fa.vitrage],
        ["Petits bois", fa.petits_bois],
        ["Volets", fa.volets],
        ["Velux — versant, dimensions, modèle", fa.velux_precisions],
        ["Cotes de positionnement (nu du mur, allège)", fa.cotes_positionnement],
      ])));
  }

  if (urbaSurfacesConcernees(d)) {
    const bats = (d.surfaces?.batiments || []);
    corps.push(bloc("Bloc 7 — Surfaces",
      tableau(["Bâtiment", "Donnée", "Existant", "Créé / supprimé", "Total après travaux"],
        bats.flatMap(bt => [
          [bt.nom, "Emprise au sol (m²)", bt.emprise_existant, bt.emprise_cree, urbaTotal(bt.emprise_existant, bt.emprise_cree)],
          ["", "Surface de plancher (m²)", bt.plancher_existant, bt.plancher_cree, urbaTotal(bt.plancher_existant, bt.plancher_cree)],
          ["", "Surface taxable (m²)", bt.taxable_existant, bt.taxable_cree, urbaTotal(bt.taxable_existant, bt.taxable_cree)],
          ["", "Nombre de niveaux", bt.niveaux_existant, bt.niveaux_cree, urbaTotal(bt.niveaux_existant, bt.niveaux_cree)],
        ]))));
  }

  if (urbaStationnementConcerne(d)) {
    const stt = d.stationnement || {};
    corps.push(bloc("Bloc 8 — Stationnement", tableauCV([
      ["Stationnement possible sur la parcelle ?", stt.possible],
      ["Nombre de places + emplacement (reporté sur le plan de masse)", [stt.nb_places, stt.emplacement].filter(Boolean).join(" — ")],
      ["Places couvertes", stt.couvertes],
      ["Places non couvertes", stt.non_couvertes],
      ["Demande de dérogation", [stt.derogation, stt.derogation_justification].filter(Boolean).join(" — ")],
      ["Local vélo", stt.local_velo],
      ["Local poubelles", stt.local_poubelles],
    ])));
  }

  corps.push(bloc("Bloc 9 — Informations complémentaires",
    '<p class="libre">' + val(d.complement) + '</p>'));

  const v = d.validation || {};
  corps.push(bloc("Bloc 10 — Validation", tableauCV([
    ["Commercial (fiche complète et vérifiée)", [v.commercial_nom, v.commercial_date ? urbaFmtDate(v.commercial_date) : "", v.commercial_visa].filter(Boolean).join(" — ")],
    ["Réception pôle urbanisme", [v.reception_nom, v.reception_date ? urbaFmtDate(v.reception_date) : "", v.reception_visa].filter(Boolean).join(" — ")],
    ["Statut", st.label],
    ["Complétude des champs obligatoires", c.pct + " % (" + c.ok + "/" + c.total + ")"],
    ["Observations", v.notes],
  ])));

  const ex = urbaExigences(d).filter(p => p.requis);
  corps.push(bloc("Checklist des pièces à joindre",
    tableau(["Pièce", "Format attendu", "Qui la produit", "Statut", "Lien / emplacement"],
      ex.map(p => [p.label, p.format, p.responsable || p.producteur, urbaPieceStatut(p.statut).label, p.lien]))));

  corps.push(bloc("Rétroplanning",
    tableau(["Étape", "Délai", "Date", "Précision"],
      retro.etapes.map(e => [e.label, e.delai, e.date ? urbaFmtDate(e.date) : "—", e.aide]))
    + (retro.alertes.length
        ? '<ul class="alertes">' + retro.alertes.map(a => '<li>' + esc(a.label) + '</li>').join("") + '</ul>'
        : "")
    + '<p class="regle">' + esc(URBA_REGLE_COMMERCIALE) + '</p>'));

  if (c.manquants.length || c.pieces.length) {
    corps.push(bloc("Ce qui manque encore",
      '<ul class="alertes">'
      + c.manquants.map(m => '<li>Bloc ' + esc(m.bloc) + ' — ' + esc(m.label) + '</li>').join("")
      + c.pieces.map(p => '<li>Pièce manquante — ' + esc(p.label) + '</li>').join("")
      + '</ul>'));
  }

  // ── Annexes ────────────────────────────────────────────────────────────
  //
  // Ce bloc DOIT rester avant l'assemblage de `html` : corps.join() figeant le
  // document, un corps.push() postérieur n'a aucun effet. C'est l'erreur qui a
  // fait que les annexes n'apparaissaient pas à l'impression.
  //
  // `pagesAnnexes` est fourni par l'appelant : images signées ET pages de PDF
  // déjà rendues en data URL. Le rendu des PDF vit côté appelant parce qu'il
  // demande pdf.js, qui n'a rien à faire dans un module de mise en page.
  if (pagesAnnexes.length) {
    const parPiece = new Map();
    for (const a of pagesAnnexes) {
      if (!parPiece.has(a.piece)) parPiece.set(a.piece, []);
      parPiece.get(a.piece).push(a);
    }

    corps.push(bloc("Annexes — pièces jointes",
      '<p class="annexe-intro">'
      + esc(`${pagesAnnexes.length} page(s) d'annexe, ${parPiece.size} pièce(s) concernée(s). `)
      + 'Chaque page est reproduite intégralement à la suite du dossier.</p>'
      + tableau(["Pièce", "Fichier", "Pages"],
          [...parPiece.entries()].map(([piece, liste]) => [
            piece, liste[0].nom, String(liste.length),
          ]))
    ));

    // Une page d'annexe par image : un plan coupé en deux ne sert à rien.
    for (const a of pagesAnnexes) {
      corps.push('<section class="annexe-page">'
        + '<h3>' + esc(a.piece) + '</h3>'
        + '<p class="annexe-nom">' + esc(a.nom)
        + (a.total > 1 ? esc(` — page ${a.page}/${a.total}`) : "") + '</p>'
        + '<img src="' + a.url + '" alt="' + esc(a.piece) + '"/>'
        + '</section>');
    }
  }

  if (annexesIgnorees.length) {
    corps.push(bloc("Pièces jointes non reproduites",
      '<p class="annexe-intro">Ces fichiers sont au dossier mais n\'ont pas pu être rendus. À joindre à la main.</p>'
      + tableau(["Pièce", "Fichier", "Raison"], annexesIgnorees.map(x => [x.piece, x.nom, x.raison]))));
  }

  // ── Mise en page ────────────────────────────────────────────────────────
  //
  // Charte Groupe Profero, déclinée pour le papier. Le parti pris : la rigueur
  // ne se montre pas, elle se lit dans la contrainte. Donc une seule couleur
  // d'accent — l'or Groupe #c9a14f — employée uniquement comme marquage
  // structurel, jamais comme décoration ; un filet unique ; un alignement à
  // gauche tenu sur toute la hauteur ; des chiffres tabulaires.
  //
  // En-tête et pied sont en position fixe : ils se répètent SUR CHAQUE PAGE à
  // l'impression. Les marges de @page leur réservent la place — sans quoi ils
  // recouvriraient le contenu de la deuxième page et des suivantes.
  //
  // Pas de numéro de page automatique : Chrome n'implémente pas les compteurs
  // dans les boîtes de marge de @page, et un compteur posé dans un élément fixe
  // ne s'incrémente pas. Plutôt que d'afficher « page 1 » sur toutes les pages,
  // le pied porte la référence du dossier et la date d'édition — ce qui
  // identifie réellement un feuillet détaché.
  const origine = (typeof window !== "undefined" && window.location?.origin) || "";
  const reference = id.reference || row?.reference || "sans référence";
  const entite = id.entite || "Profero Invest";
  const adresseCourte = [b.adresse, b.commune].filter(Boolean).join(", ");

  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    + '<title>FDU ' + esc(reference) + '</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    + 'family=Barlow+Condensed:wght@500;600;700&family=DM+Mono:wght@400;500&display=swap">'
    + '<style>'
    // Marges généreuses en haut et en bas : c'est là que vivent l'en-tête et le
    // pied fixes, qui doivent apparaître sur chaque page.
    + '@page{size:A4;margin:27mm 15mm 19mm}'
    + '*{box-sizing:border-box}'
    + ':root{'
    +   '--encre:#1a1f2e;--encre-2:#535d70;--encre-3:#8b93a3;'
    +   '--filet:#dcdfe6;--or:#c9a14f;--manque:#a8322c;--doux:#f7f8fa;'
    + '}'
    + 'html,body{margin:0;padding:0}'
    + 'body{'
    +   'font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;'
    +   'color:var(--encre);font-size:10.4px;line-height:1.5;'
    +   '-webkit-print-color-adjust:exact;print-color-adjust:exact;'
    + '}'
    + '.cond{font-family:"Barlow Condensed","Arial Narrow",sans-serif}'
    + '.mono{font-family:"DM Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}'

    /* ── Furniture de page, répétée à l'identique ───────────────────────── */
    + '.entete{position:fixed;top:-21mm;left:0;right:0;height:17mm;'
    +   'display:flex;align-items:flex-end;justify-content:space-between;gap:10mm;'
    +   'border-bottom:1.6pt solid var(--encre);padding-bottom:2mm}'
    + '.entete .marque{display:flex;align-items:flex-end;gap:3mm}'
    + '.entete img{height:9mm;width:auto;display:block}'
    + '.entete .titre{font-family:"Barlow Condensed","Arial Narrow",sans-serif;'
    +   'font-size:13.5px;font-weight:700;letter-spacing:.2px;line-height:1;'
    +   'text-transform:uppercase}'
    + '.entete .droite{text-align:right;line-height:1.35}'
    + '.entete .ref{font-family:"DM Mono",monospace;font-size:10px;font-weight:500;'
    +   'letter-spacing:.3px}'
    + '.entete .ent{font-size:8.4px;color:var(--encre-3);text-transform:uppercase;'
    +   'letter-spacing:1.4px}'
    /* Le seul emploi de l'or : un segment sous le filet d'en-tête, à gauche.
       Il marque l'appartenance sans jamais concurrencer le texte. */
    + '.entete::after{content:"";position:absolute;left:0;bottom:-1.6pt;'
    +   'width:24mm;height:1.6pt;background:var(--or)}'

    + '.pied{position:fixed;bottom:-14mm;left:0;right:0;height:10mm;'
    +   'border-top:.5pt solid var(--filet);padding-top:1.6mm;'
    +   'display:flex;justify-content:space-between;gap:6mm;'
    +   'font-size:8.2px;color:var(--encre-3);letter-spacing:.2px}'
    + '.pied .mono{font-size:8.2px}'

    /* ── Bandeau d'ouverture, page 1 uniquement ─────────────────────────── */
    + '.ouverture{margin:0 0 9mm}'
    + '.ouverture h1{font-family:"Barlow Condensed","Arial Narrow",sans-serif;'
    +   'font-size:26px;font-weight:700;line-height:1.02;margin:0 0 2.5mm;'
    +   'letter-spacing:-.2px}'
    + '.ouverture .sous{font-size:10.6px;color:var(--encre-2);margin:0 0 4mm}'
    /* Grille des faits saillants : trois colonnes, largeurs égales, alignées
       sur la même gouttière que le reste du document. */
    + '.faits{display:grid;grid-template-columns:repeat(3,1fr);'
    +   'border-top:.5pt solid var(--filet);border-left:.5pt solid var(--filet)}'
    + '.faits div{border-right:.5pt solid var(--filet);border-bottom:.5pt solid var(--filet);'
    +   'padding:2.4mm 3mm}'
    + '.faits dt{font-size:7.8px;text-transform:uppercase;letter-spacing:1.1px;'
    +   'color:var(--encre-3);margin:0 0 1mm}'
    + '.faits dd{margin:0;font-size:10.8px;font-weight:600}'
    + '.faits .alerte dd{color:var(--manque)}'

    /* ── Sections ───────────────────────────────────────────────────────── */
    + '.bloc{margin:0 0 7mm;break-inside:avoid}'
    + '.bloc h2{font-family:"Barlow Condensed","Arial Narrow",sans-serif;'
    +   'font-size:11.6px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;'
    +   'margin:0 0 2.6mm;padding:0 0 1.4mm;border-bottom:.5pt solid var(--encre);'
    +   'display:flex;align-items:baseline;gap:2.5mm}'
    /* Marqueur de section : un carré plein, pas une puce ni une icône. */
    + '.bloc h2::before{content:"";width:2.2mm;height:2.2mm;background:var(--or);'
    +   'flex:0 0 auto;transform:translateY(-.3mm)}'

    /* ── Tableaux ───────────────────────────────────────────────────────── */
    + 'table{width:100%;border-collapse:collapse;margin:0}'
    + 'table.cv th{width:36%;text-align:left;font-weight:600;font-size:9.6px;'
    +   'color:var(--encre-2);background:var(--doux);'
    +   'border-bottom:.5pt solid var(--filet);padding:2mm 3mm;vertical-align:top}'
    + 'table.cv td{border-bottom:.5pt solid var(--filet);padding:2mm 3mm;vertical-align:top}'
    + 'table.cv tr:last-child th,table.cv tr:last-child td{border-bottom:.5pt solid var(--encre)}'
    + 'table.grille th{background:var(--encre);color:#fff;font-size:8.4px;'
    +   'text-transform:uppercase;letter-spacing:1px;padding:2mm 2.6mm;text-align:left;'
    +   'font-weight:600}'
    + 'table.grille td{border-bottom:.5pt solid var(--filet);padding:2mm 2.6mm;font-size:9.8px}'
    + 'table.grille tr:last-child td{border-bottom:.5pt solid var(--encre)}'

    /* ── États ──────────────────────────────────────────────────────────── */
    /* Le rouge ne sert qu'à une chose : ce qui manque. Jamais à décorer. */
    + '.vide{color:var(--manque);font-style:normal;font-weight:600}'
    + '.libre{border:.5pt solid var(--filet);border-left:1.2pt solid var(--encre);'
    +   'padding:2.6mm 3mm;white-space:pre-wrap;min-height:11mm;background:var(--doux)}'
    + '.vigilance{border:.5pt solid var(--encre);border-left:2.4pt solid var(--or);'
    +   'padding:2.6mm 3.4mm;margin:0 0 7mm;background:#fdfbf6}'
    + '.alertes{margin:1.6mm 0 0;padding-left:4.6mm;list-style:none}'
    + '.alertes li{margin-bottom:.9mm;position:relative}'
    + '.alertes li::before{content:"—";position:absolute;left:-4.6mm;color:var(--encre-3)}'
    + '.regle{margin:2.6mm 0 0;padding:2.4mm 3mm;border-left:1.2pt solid var(--or);'
    +   'background:var(--doux);font-size:9.6px;color:var(--encre-2)}'

    /* ── Annexes ────────────────────────────────────────────────────────── */
    + '.saut{page-break-before:always}'
    + '.annexe-intro{font-size:9.8px;color:var(--encre-2);margin:0 0 3.4mm}'
    + '.annexe-page{page-break-before:always}'
    + '.annexe-page h3{font-family:"Barlow Condensed","Arial Narrow",sans-serif;'
    +   'font-size:11.6px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;'
    +   'margin:0 0 .8mm;padding:0 0 1.4mm;border-bottom:.5pt solid var(--encre)}'
    + '.annexe-nom{font-family:"DM Mono",monospace;font-size:8.6px;color:var(--encre-3);'
    +   'margin:0 0 3.4mm;font-style:normal}'
    /* La pièce occupe la page utile, centrée, jamais coupée ni déformée. */
    + '.annexe-page img{display:block;margin:0 auto;max-width:100%;max-height:213mm;'
    +   'object-fit:contain;border:.5pt solid var(--filet)}'
    + '</style></head><body>'

    // En-tête et pied : les MÊMES sur chaque page, par position fixe.
    + '<header class="entete">'
    +   '<span class="marque">'
    +     (origine ? '<img src="' + esc(origine) + '/logos/groupe-profero-h.png" alt="Groupe Profero">' : "")
    +     '<span class="titre">Fiche de demande urbanisme</span>'
    +   '</span>'
    +   '<span class="droite">'
    +     '<span class="ref">' + esc(reference) + '</span><br>'
    +     '<span class="ent">' + esc(entite) + '</span>'
    +   '</span>'
    + '</header>'
    + '<footer class="pied">'
    +   '<span>Document interne — une FDU incomplète n\'est pas prise en charge et repart au commercial.</span>'
    +   '<span class="mono">' + esc(reference) + ' · ' + esc(new Date().toLocaleDateString("fr-FR")) + '</span>'
    + '</footer>'

    // Ouverture, page 1 : le dossier se présente avant de se dérouler.
    + '<section class="ouverture">'
    +   '<h1>' + esc(reference) + '</h1>'
    +   '<p class="sous">' + esc(adresseCourte || "Adresse non renseignée") + '</p>'
    +   '<dl class="faits">'
    +     '<div><dt>Nature</dt><dd>' + esc(naturesLabels || "Non précisée") + '</dd></div>'
    +     '<div><dt>Autorisation</dt><dd>' + esc(nat.autorisation || "À trancher") + '</dd></div>'
    +     '<div' + (b.abf === "Oui" ? ' class="alerte"' : "") + '><dt>Secteur ABF</dt>'
    +       '<dd>' + esc(b.abf || "À vérifier") + '</dd></div>'
    +     '<div><dt>Statut</dt><dd>' + esc(st.label) + '</dd></div>'
    +     '<div' + (c.pct < 100 ? ' class="alerte"' : "") + '><dt>Complétude</dt>'
    +       '<dd class="mono">' + esc(String(c.pct)) + ' %</dd></div>'
    +     '<div><dt>Date maximum de dépôt</dt>'
    +       '<dd class="mono">' + esc(urbaFmtDate(id.date_max_depot) || "—") + '</dd></div>'
    +   '</dl>'
    + '</section>'
    + corps.join("")
    // Pas de pied en fin de document : le pied FIXE apparaît déjà sur chaque
    // page, celui-ci ferait doublon sur la dernière.
    + '</body></html>';

  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) { alert("Autorisez les pop-ups pour imprimer la FDU."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();

  // Les annexes sont des images distantes : imprimer avant leur chargement
  // produirait des pages blanches. On attend, avec un plafond — un lien
  // expiré ou un réseau coupé ne doit pas bloquer l'impression du reste.
  const lancer = () => { try { win.print(); } catch { /* l'utilisateur imprimera à la main */ } };

  // Les polices Barlow Condensed et DM Mono viennent du réseau : imprimer avant
  // leur chargement produirait une mise en page en police de repli, aux
  // largeurs différentes. On les attend, sans jamais bloquer indéfiniment.
  const attendrePolices = () => {
    try {
      return win.document.fonts?.ready
        ? Promise.race([win.document.fonts.ready, new Promise(r => setTimeout(r, 3000))])
        : Promise.resolve();
    } catch { return Promise.resolve(); }
  };

  if (!pagesAnnexes.length) { attendrePolices().then(() => setTimeout(lancer, 250)); return; }

  const attendreImages = () => {
    const liste = Array.from(win.document.images || []);
    if (!liste.length) return Promise.resolve();
    return Promise.all(liste.map(img => img.complete
      ? Promise.resolve()
      : new Promise(res => { img.onload = res; img.onerror = res; })));
  };
  Promise.race([
    Promise.all([attendreImages(), attendrePolices()]),
    new Promise(res => setTimeout(res, 8000)),   // plafond : 8 s
  ]).then(() => setTimeout(lancer, 250));
}
