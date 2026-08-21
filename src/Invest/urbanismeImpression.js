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

  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    + '<title>FDU ' + esc(id.reference || row?.reference || "") + '</title>'
    + '<style>'
    + '@page{size:A4;margin:14mm}'
    + '*{box-sizing:border-box}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#111;margin:0;font-size:11.5px;line-height:1.45}'
    + 'header.fdu{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}'
    + 'header.fdu .eyebrow{text-transform:uppercase;letter-spacing:2px;font-size:9.5px;color:#666;margin:0 0 4px}'
    + 'header.fdu h1{font-size:19px;margin:0 0 6px}'
    + 'header.fdu .meta{font-size:10.5px;color:#444}'
    + '.bloc{margin:0 0 14px;break-inside:avoid}'
    + '.bloc h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;padding-bottom:3px;border-bottom:1px solid #bbb}'
    + 'table{width:100%;border-collapse:collapse;margin:0 0 8px}'
    + 'table.cv th{width:38%;text-align:left;font-weight:600;color:#333;background:#f4f4f4;border:1px solid #ddd;padding:4px 6px;vertical-align:top}'
    + 'table.cv td{border:1px solid #ddd;padding:4px 6px}'
    + 'table.grille th{background:#111;color:#fff;font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;padding:4px 5px;border:1px solid #111;text-align:left}'
    + 'table.grille td{border:1px solid #ccc;padding:4px 5px;font-size:10.5px}'
    + '.vide{color:#b00;font-style:italic}'
    + '.libre{border:1px solid #ddd;padding:8px;white-space:pre-wrap;min-height:40px}'
    + '.vigilance{border:1px solid #111;background:#f7f2e0;padding:8px;margin:0 0 14px}'
    + '.alertes{margin:6px 0 0;padding-left:18px}'
    + '.alertes li{margin-bottom:3px}'
    + '.regle{margin:8px 0 0;padding:7px;border-left:3px solid #111;background:#f4f4f4;font-style:italic}'
    + 'footer{margin-top:18px;border-top:1px solid #bbb;padding-top:6px;font-size:9.5px;color:#666}'
    /* Annexes : une image par page, jamais coupée. */
    + '.saut{page-break-before:always}'
    + '.annexe-intro{font-size:10.5px;color:#444;margin:0 0 10px}'
    + '.annexe-page{page-break-before:always;text-align:center}'
    + '.annexe-page h3{font-size:13px;margin:0 0 2px;text-align:left}'
    + '.annexe-nom{font-size:9.5px;color:#666;margin:0 0 8px;text-align:left;font-style:italic}'
    + '.annexe-page img{max-width:100%;max-height:23cm;object-fit:contain;border:1px solid #ccc}'
    + '</style></head><body>'
    + '<header class="fdu"><p class="eyebrow">' + esc(id.entite || "Profero Invest") + ' · Urbanisme</p>'
    + '<h1>Fiche de demande urbanisme — ' + esc(id.reference || row?.reference || "sans référence") + '</h1>'
    + '<p class="meta">' + esc([b.adresse, b.code_postal, b.commune].filter(Boolean).join(", ") || "Adresse non renseignée")
    + ' · ' + esc(naturesLabels || "Nature non précisée")
    + ' · ' + esc(nat.autorisation || "Autorisation à trancher")
    + (b.abf === "Oui" ? " · SECTEUR ABF" : "")
    + ' · Statut : ' + esc(st.label) + '</p></header>'
    + corps.join("")
    + '<footer>Éditée le ' + esc(new Date().toLocaleDateString("fr-FR")) + '. '
    + 'Une FDU incomplète n\'est pas prise en charge et repart au commercial.</footer>'
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
  if (!pagesAnnexes.length) { setTimeout(lancer, 350); return; }

  const attendreImages = () => {
    const liste = Array.from(win.document.images || []);
    if (!liste.length) return Promise.resolve();
    return Promise.all(liste.map(img => img.complete
      ? Promise.resolve()
      : new Promise(res => { img.onload = res; img.onerror = res; })));
  };
  Promise.race([
    attendreImages(),
    new Promise(res => setTimeout(res, 8000)),   // plafond : 8 s
  ]).then(() => setTimeout(lancer, 200));
}
