// src/Invest/structurationRapport.mjs — Rapport d'étude patrimoniale à deux niveaux (lot 5).
//
//   niveau "synthese" : la synthèse exécutive, 10 pages lisibles par le client ;
//   niveau "complet"  : la synthèse + les annexes (situation détaillée, fiches des biens, hypothèses, validations externes).
//
// Module pur : il reçoit le dossier et renvoie une chaîne HTML complète. Il n'appelle ni la base ni l'horloge (la date,
// l'année de départ et les noms arrivent en paramètres). Tout texte issu du dossier est échappé.
//
// Règles de rédaction : aucun chiffre n'est inventé. Une donnée absente s'écrit « À préciser » ou « non calculable »,
// jamais zéro. Tout chiffre de projection ou de fiscalité est présenté comme une estimation avant impôt.

import { num, analyserBien, analyserFlux, analyserObjectifs, analyserProfilImmo, DIMENSIONS_PROFIL_IMMO, CATEGORIES_CHARGES, analyserDettes } from "./structurationDonnees.mjs";
import { situation, analyserSwot, trajectoireCapacite, HYPOTHESES_PAR_DEFAUT } from "./structurationDiagnostic.mjs";
import { projeter, comparerScenarios, testsResistance, jalons, CAS, LIBELLES_CAS, LIBELLES_HYPOTHESES, HYPOTHESES_CAS_PAR_DEFAUT, HYPOTHESES_GLOBALES_PAR_DEFAUT, operationComplete } from "./structurationProjection.mjs";
import { comparerStructures, HYPOTHESES_STRUCTURES_PAR_DEFAUT } from "./structurationStructures.mjs";
import { construireFeuilleRoute, scenarioRetenu, LIBELLES_TYPES } from "./structurationFeuilleRoute.mjs";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ND = "non calculable", AP = "À préciser";
const eur = (v) => (v === null || v === undefined || !Number.isFinite(v) ? ND : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} €`);
const pc = (v) => (v === null || v === undefined || !Number.isFinite(v) ? ND : `${Math.round(v * 100)} %`);
const pc1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? ND : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const texte = (v) => (String(v ?? "").trim() === "" ? AP : esc(v));
const arr = (a) => (Array.isArray(a) ? a : []);

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#0D1B2A;font-family:'DM Sans',Arial,sans-serif;font-size:11.5px;line-height:1.45}
.page{width:210mm;min-height:297mm;margin:0 auto 8mm;background:#fff;padding:16mm 14mm 20mm;position:relative;page-break-after:always}
.cover{background:#0D1B2A;color:#F5F0E8}.cover h1{font-family:Georgia,serif;font-weight:400;font-size:40px;line-height:1.05;margin:28mm 0 6mm}.cover .k{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#C9A84C}.cover .v{font-size:15px;font-weight:700;margin:3px 0 8mm}
.sec{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#C9A84C;font-weight:800;margin-bottom:2mm}h2{font-family:Georgia,serif;font-weight:400;font-size:25px;margin:0 0 5mm}h3{font-size:12.5px;margin:5mm 0 2mm}
.line{height:1px;background:#e3e3e3;margin-bottom:5mm}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-bottom:5mm}.card{border:1px solid #e1e5ea;border-radius:6px;padding:3mm 3.5mm}.card b{display:block;font-size:15px}.card span{font-size:9.5px;color:#667}
.card.red b{color:#b42318}.card.green b{color:#15803d}.card.gold b{color:#8a6a1d}
table{width:100%;border-collapse:collapse;margin-bottom:4mm}th{text-align:left;font-size:9.5px;color:#667;text-transform:uppercase;letter-spacing:.4px;padding:4px 6px;border-bottom:1.5px solid #d5d9df}td{padding:4px 6px;border-bottom:1px solid #eceff3;vertical-align:top}td.n,th.n{text-align:right;white-space:nowrap}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.swot div{border-top:3px solid #ccc;background:#f7f8fa;padding:2.5mm 3mm;margin-bottom:3mm;border-radius:4px}.swot b{font-size:11px}.swot p{margin:2px 0 4px;color:#445}
.f{border-top:3px solid #15803d}.w{border-top:3px solid #d97706}.r{border-top:3px solid #b42318}.o{border-top:3px solid #2563eb}
.note{border-left:3px solid #C9A84C;background:#fdfbf6;padding:3mm 4mm;margin:4mm 0;color:#445}.warn{color:#b45309;font-weight:700}.muted{color:#778}
.footer{position:absolute;left:14mm;right:14mm;bottom:8mm;border-top:1px solid #dde;padding-top:3mm;font-size:8px;color:#8a96a3;display:flex;justify-content:space-between}
.no-print{text-align:center;padding:10px}.btn{background:#0D1B2A;color:#fff;border:0;padding:9px 18px;border-radius:6px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.no-print{display:none}.page{margin:0;box-shadow:none}}
`;

const table = (entetes, lignes, num_ = []) => `<table><thead><tr>${entetes.map((e, i) => `<th class="${num_.includes(i) ? "n" : ""}">${esc(e)}</th>`).join("")}</tr></thead><tbody>${
  lignes.length ? lignes.map((l) => `<tr>${l.map((c, i) => `<td class="${num_.includes(i) ? "n" : ""}">${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${entetes.length}" class="muted">Aucune donnée saisie.</td></tr>`}</tbody></table>`;
const kv = (paires) => table(["", ""], paires.map(([k, v]) => [esc(k), v]));
const cartes = (liste) => `<div class="cards">${liste.map(([label, valeur, ton]) => `<div class="card ${ton || ""}"><b>${valeur}</b><span>${esc(label)}</span></div>`).join("")}</div>`;
const courbe = (series, horizon) => {
  const W = 640, H = 200, pad = 40;
  const tous = series.flatMap((s) => s.valeurs), min = Math.min(0, ...tous), max = Math.max(1, ...tous);
  const x = (k) => pad + (k / horizon) * (W - pad - 12), y = (v) => H - 24 - ((v - min) / (max - min || 1)) * (H - 44);
  const couleurs = { prudent: "#d97706", central: "#2563eb", degrade: "#b42318" };
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Patrimoine net projeté">${
    [0, 5, 10, 20].filter((k) => k <= horizon).map((k) => `<text x="${x(k)}" y="${H - 6}" font-size="10" fill="#778" text-anchor="middle">${k === 0 ? "auj." : `${k} ans`}</text>`).join("")}
    <line x1="${pad}" y1="${y(0)}" x2="${W - 12}" y2="${y(0)}" stroke="#ccd" stroke-dasharray="3 3"/>
    <text x="2" y="${y(max) + 4}" font-size="10" fill="#778">${esc(eur(max))}</text>${
    series.map((s) => `<polyline fill="none" stroke="${couleurs[s.cas]}" stroke-width="2.2" points="${s.valeurs.map((v, k) => `${x(k)},${y(v)}`).join(" ")}"/>`).join("")}</svg>
    <div class="muted">${series.map((s) => `<span style="color:${couleurs[s.cas]}">■</span> ${esc(LIBELLES_CAS[s.cas])}`).join(" &nbsp; ")}</div>`;
};

/**
 * @param data     le dossier de structuration (data.collecte, data.analyse, …)
 * @param options  { niveau: "synthese" | "complet", clientNom, titre, conseiller, dateLongue, anneeDepart }
 * @returns        document HTML complet
 */
export function construireRapportHtml(data, { niveau = "synthese", clientNom = "Client", titre = "", conseiller = "", dateLongue = "", anneeDepart } = {}) {
  const c = data?.collecte || {}, a = data?.analyse || {};
  const surcharges = data?.hypotheses_projection || {};
  const hyp = { ...HYPOTHESES_PAR_DEFAUT, ...(data?.hypotheses_diagnostic || {}) };
  const s = situation(data), flux = analyserFlux(c), sw = analyserSwot(data, hyp);
  const objectifs = analyserObjectifs(c.objectifs_mesures);
  const scenarios = arr(data?.scenarios_chiffres);
  const retenu = scenarioRetenu(data);
  const opsRetenues = arr(retenu?.operations).filter(operationComplete);
  const opsEnvisagees = arr(data?.operations_envisagees);
  const trajectoire = trajectoireCapacite(data, opsRetenues.length ? opsRetenues : opsEnvisagees, hyp);
  const comparaison = comparerScenarios(data, scenarios, { cas: "central", horizon: 10, anneeDepart, surcharges });
  const projections = CAS.map((cas) => ({ cas, p: projeter(data, { operations: opsRetenues, cas, anneeDepart, surcharges, horizon: 20 }) }));
  const tests = testsResistance(data, { operations: opsRetenues, anneeDepart, surcharges });
  const route = construireFeuilleRoute(data, { anneeDepart, hypotheses: hyp });
  const premiereOp = opsRetenues[0] || null;
  const structures = premiereOp ? comparerStructures(data, premiereOp, { surcharges, parametres: data?.parametres_structures || {} }) : null;
  const limites = projections[1].p.limites;

  let numero = 0;
  const pied = () => { numero += 1; return `<div class="footer"><span>Profero Invest — ${esc(clientNom)}</span><span>Étude patrimoniale — estimations avant impôt</span><span>${numero}</span></div>`; };
  const page = (sec, h2, corps) => `<section class="page"><div class="sec">${esc(sec)}</div><h2>${esc(h2)}</h2><div class="line"></div>${corps}${pied()}</section>`;

  // ── Synthèse exécutive ──────────────────────────────────────────────────────────────────────
  const couverture = `<section class="page cover"><div class="k">Profero Invest · Étude patrimoniale</div><h1>${esc(titre || "Votre étude patrimoniale immobilière")}</h1>
    <div class="k">Établie pour</div><div class="v">${esc(clientNom)}</div>
    <div class="k">Conseiller</div><div class="v">${texte(conseiller)}</div>
    <div class="k">Date</div><div class="v">${texte(dateLongue)}</div>
    <div class="k">Document</div><div class="v">${niveau === "complet" ? "Rapport complet (synthèse et annexes)" : "Synthèse exécutive"}</div>
    <p style="position:absolute;left:14mm;right:14mm;bottom:16mm;color:rgba(245,240,232,.6);font-size:10px">Étude établie à partir des informations communiquées par le client, à titre indicatif. Les chiffres de projection et de fiscalité sont des estimations avant impôt, fondées sur des hypothèses affichées dans ce document ; les sujets juridiques et fiscaux sont à valider avec le notaire et l'expert-comptable.</p></section>`;

  const p1 = page("01 — Où vous en êtes", "Votre situation en un coup d'œil", cartes([
    ["Patrimoine brut", eur(s.patrimoineBrut)], ["Dettes", eur(s.dettes), "red"], ["Patrimoine net", eur(s.patrimoineNet), s.patrimoineNet < 0 ? "red" : "green"],
    ["Liquidités", eur(s.liquidites)], ["Part de l'immobilier", pc(s.composition.partImmobilier)], ["Revenus récurrents par an", eur(s.revenusAnnuelsRecurrents)],
    ["Épargne réelle par an", eur(s.epargneAnnuelle)], ["Cash-flow immobilier par mois", eur(s.cashflowImmobilierMois)], ["Tranche d'imposition", esc(s.tmi || "non renseignée")],
  ]) + `<div class="note">${esc(a.diagnostic ? String(a.diagnostic).split("\n")[0] : "Le diagnostic rédigé du conseiller figure page 5 et en annexe.")}</div>` +
    (s.nonCompte.length ? `<p class="warn">Non compté dans le patrimoine brut : ${esc(s.nonCompte.join(", "))}.</p>` : ""));

  const p2 = page("02 — Où vous voulez aller", "Vos objectifs", table(["Priorité", "Objectif", "Montant", "Échéance", "Souplesse"],
    objectifs.parPriorite.map((o) => [esc(o.priorite || "—"), esc(o.libelle || o.type || "Objectif"), o.montant ? eur(num(o.montant)) : AP, esc(o.echeance || AP), esc(o.flexibilite || "—")]), [2]) +
    (objectifs.incomplets ? `<p class="warn">${objectifs.incomplets} objectif(s) sans montant, échéance ou priorité : ils ne peuvent pas être pris en compte dans la trajectoire.</p>` : "") +
    kv([["Objectif principal", texte(c.objectifs?.objectif_principal)], ["Horizon", texte(c.objectifs?.horizon)], ["Zones souhaitées", texte(c.objectifs?.zones)]]));

  const lignesBiens = arr(c.patrimoine?.lots).map((l, i) => { const b = analyserBien(l); return [esc(l.adresse || `Bien ${i + 1}`), esc(l.structure || "—"), eur(num(l.valeur)), eur(num(l.crd)), pc1(b.rendementBrut), b.cashflowMois === null ? ND : `${eur(b.cashflowMois)}/mois`]; });
  const p3 = page("03 — Ce que vous avez bâti", "Votre patrimoine actuel", `<h3>Composition</h3>` + table(["Poste", "Montant", "Part"], [
    ["Immobilier (biens locatifs et résidence principale)", eur(s.composition.immobilier), pc(s.composition.partImmobilier)],
    ["Placements financiers", eur(s.composition.financier), pc(s.composition.partFinancier)], ["Liquidités", eur(s.composition.liquidites), pc(s.composition.partLiquidites)],
    ["Dettes", eur(s.dettes), ""], ["<b>Patrimoine net</b>", `<b>${eur(s.patrimoineNet)}</b>`, ""]], [1, 2]) +
    `<h3>Biens locatifs (avant impôt)</h3>` + table(["Bien", "Détention", "Valeur", "Capital restant dû", "Rendement brut", "Cash-flow"], lignesBiens, [2, 3, 4, 5]) +
    (s.repartitionDettes.length ? `<h3>Répartition des dettes</h3>` + table(["Dette", "Capital restant dû"], s.repartitionDettes.map((d) => [esc(d.libelle), eur(d.montant)]), [1]) : ""));

  const p4 = page("04 — Ce que vous pouvez faire", "Vos flux et votre capacité d'investissement", cartes([
    ["Revenus récurrents par mois", eur(flux.revenusRecurrentsMois)], ["Charges du foyer par mois", eur(flux.chargesFoyerMois)], ["Capacité d'épargne théorique par mois", eur(flux.capaciteEpargneTheorique)],
    ["Épargne réellement constatée par mois", eur(flux.epargneReelle)], ["Écart", flux.ecart === null ? ND : `${flux.ecart >= 0 ? "+" : ""}${eur(flux.ecart)}`, flux.ecart !== null && flux.ecart < 0 ? "red" : ""], ["Mensualités de dettes par mois", eur(s.mensualitesTotal)],
  ]) + `<h3>Capacité d'emprunt : aujourd'hui, puis après chaque opération</h3>` + table(["Étape", "Endettement", "Marge mensuelle", "Capital empruntable", "Lecture"],
    trajectoire.etapes.map((e) => [esc(e.libelle), pc(e.tauxEndettement), eur(e.mensualiteDisponible), eur(e.capitalEmpruntable), esc(e.lecture)]), [1, 2, 3]) +
    `<p class="muted">Hypothèses : plafond d'endettement ${esc(trajectoire.hypotheses.plafondEndettement)} %, crédit à ${esc(trajectoire.hypotheses.tauxCredit)} % sur ${esc(trajectoire.hypotheses.dureeCredit)} ans, ${esc(trajectoire.hypotheses.loyersRetenusBanque)} % des loyers retenus. Estimation : la décision appartient à la banque.</p>`);

  const swot = (cle, cls, titre_) => `<div class="${cls}"><b>${titre_}</b>${sw[cle].length ? sw[cle].map((x) => `<p><b>${esc(x.titre)}</b><br>${esc(x.detail)}</p>`).join("") : `<p class="muted">Rien à signaler avec les données saisies.</p>`}</div>`;
  const p5 = page("05 — Notre lecture", "Notre diagnostic", `<div class="cols swot"><div>${swot("forces", "f", "Forces")}${swot("faiblesses", "w", "Faiblesses")}</div><div>${swot("risques", "r", "Risques")}${swot("opportunites", "o", "Opportunités")}</div></div>` +
    (a.points_attention ? `<div class="note"><b>Points d'attention du conseiller —</b> ${esc(a.points_attention)}</div>` : ""));

  const lignesCmp = [["Patrimoine net à 10 ans", "patrimoineNet"], ["Dettes", "dettes"], ["Capital remboursé", "capitalRembourse"], ["Cash-flow annuel du foyer", "cashflowAnnuel"], ["Liquidités", "liquidites"], ["Effort d'épargne maximal par an", "effortEpargneMax"]];
  const p6 = page("06 — Les trajectoires possibles", "Les stratégies étudiées", comparaison.length > 1
    ? table(["", ...comparaison.map((x) => x.nom)], [...lignesCmp.map(([t, k]) => [esc(t), ...comparaison.map((x) => eur(x[k]))]),
      ["<b>Tenable ?</b>", ...comparaison.map((x) => (x.anneeInsuffisance ? `<span class="warn">Non, dès ${esc(x.anneeInsuffisance)}</span>` : "Oui"))]], comparaison.map((_, i) => i + 1))
      + `<p class="muted">Cas central, à 10 ans, avant impôt.</p>`
    : `<p class="muted">Aucun scénario chiffré n'a été construit pour ce dossier. La situation actuelle est la seule trajectoire projetée.</p>` +
      table(["", "Situation actuelle"], lignesCmp.map(([t, k]) => [esc(t), eur(comparaison[0][k])])));

  const p7 = page("07 — Notre recommandation", "La stratégie retenue", (retenu
    ? `<p>Scénario retenu : <b>${esc(retenu.nom)}</b> — ${opsRetenues.length} opération(s).</p>` + table(["Année", "Opération", "Prix", "Apport", "Loyer attendu"], opsRetenues.map((o) => [esc(o.annee), esc(o.libelle || "Opération"), eur(num(o.prix)), eur(num(o.apport)), o.loyer_mois ? `${eur(num(o.loyer_mois))}/mois` : AP]), [2, 3, 4])
    : `<p class="warn">Aucun scénario n'a encore été retenu : cette page se complète lorsque le conseiller et le client ont arrêté leur choix.</p>`) +
    (a.strategie_recommandee ? `<div class="note"><b>Pourquoi —</b> ${esc(a.strategie_recommandee)}</div>` : "") +
    (structures && structures.structures.length ? `<h3>Détention de la première acquisition (estimation sur ${esc(structures.horizon)} ans)</h3>` + table(["Structure", "Régime", "Impôt annuel moyen", "Impôt de sortie", "Gain net total"],
      structures.structures.map((x) => [esc(x.libelle), esc(x.libelleRegime), eur(x.annuel.impotMoyen), eur(x.sortie.impotSortie), eur(x.gainNet)]), [2, 3, 4]) + `<p class="muted">Aucune structure n'est présentée comme la meilleure : choix à arrêter avec l'expert-comptable et le notaire.</p>`
      : structures && structures.manquants.length ? `<p class="muted">Comparaison des structures non calculable : il manque ${esc(structures.manquants.join(", "))}.</p>` : ""));

  const jal = (p) => jalons(p, [5, 10, 20]);
  const p8 = page("08 — Où cela mène", "Projection à 5, 10 et 20 ans", courbe(projections.map(({ cas, p }) => ({ cas, valeurs: p.annees.map((x) => x.patrimoineNet) })), 20) +
    table(["Cas", "Échéance", "Patrimoine net", "Dettes", "Loyers par an", "Liquidités"], projections.flatMap(({ cas, p }) => jal(p).filter((j) => !j.indisponible).map((j) => [esc(LIBELLES_CAS[cas]), `${esc(j.ans)} ans`, eur(j.patrimoineNet), eur(j.dettes), eur(j.loyersEncaisses), eur(j.liquidites)])), [2, 3, 4, 5]) +
    `<p class="muted">Le cas prudent, le cas central et le cas dégradé encadrent le résultat. Hypothèses détaillées en dernière page.</p>`);

  const p9 = page("09 — Si les choses tournent mal", "Risques et tests de résistance", `<p>Pour le scénario ${esc(retenu ? retenu.nom : "actuel")}, cas central, sur 5 ans : liquidités au plus bas <b>${eur(tests.reference.liquiditesMin)}</b>, pire cash-flow annuel <b>${eur(tests.reference.pireCashflow)}</b>.</p>` +
    table(["Choc", "Liquidités au plus bas", "La trésorerie tient-elle ?"], tests.chocs.map((x) => [esc(x.libelle), eur(x.liquiditesMin), x.tient ? "Oui" : `<span class="warn">Non, dès ${esc(x.anneeInsuffisance)}</span>`]), [1]) +
    (sw.risques.length ? `<h3>Risques identifiés</h3><ul>${sw.risques.map((x) => `<li><b>${esc(x.titre)}</b> — ${esc(x.detail)}</li>`).join("")}</ul>` : ""));

  const lignesRoute = route.parAnnee.flatMap((g) => g.items.map((it, i) => [i === 0 ? `<b>${esc(g.annee)}</b>` : "", esc(LIBELLES_TYPES[it.type]), `<b>${esc(it.titre)}</b>${it.detail ? `<br><span class="muted">${esc(it.detail)}</span>` : ""}`, esc(it.responsable || "—"), esc(it.statut), esc(it.dependance || "—")]));
  const p10 = page("10 — Ce que nous faisons maintenant", "Votre plan d'action", table(["Année", "Nature", "Action", "Responsable", "Statut", "Dépend de"], lignesRoute) +
    route.manquants.map((m) => `<p class="warn">À compléter : ${esc(m)}.</p>`).join("") + route.alertes.map((m) => `<p class="warn">${esc(m)}</p>`).join(""));

  const synthese = [couverture, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];

  // ── Annexes (rapport complet) ───────────────────────────────────────────────────────────────
  const pr = c.profil || {}, sfd = c.situation_familiale_detail || {}, enfants = arr(c.enfants_liste), fin = c.patrimoine_financier || {}, pat = c.patrimoine || {};
  const annexes = [];
  annexes.push(page("Annexe A — Famille", "Situation familiale et professionnelle", kv([
    ["Situation familiale", texte(pr.situation_familiale)], ["Régime matrimonial", texte(pr.regime_matrimonial)], ["Profession", texte(pr.profession)], ["Statut professionnel", texte(pr.statut_pro)],
    ["Employeur", texte(pr.employeur)], ["Ancienneté", texte(pr.anciennete)], ["Résidence fiscale", texte(c.statut_fiscal?.resident_fiscal_depuis)]]) +
    `<h3>Enfants</h3>` + table(["Prénom", "Naissance", "Union", "À charge", "Études, besoins"], enfants.map((e) => [esc(e.prenom || "—"), esc(e.naissance || "—"), esc(e.union || "—"), esc(e.a_charge || "—"), esc(e.besoins || "—")])) +
    `<h3>Protection familiale</h3>` + kv([["Donation entre époux, testament", texte(sfd.testament_donation)], ["Clause bénéficiaire d'assurance-vie", texte(sfd.assurance_vie_clause_beneficiaire)], ["Statut du couple", texte(sfd.statut_couple)]])));
  annexes.push(page("Annexe B — Flux", "Revenus, charges et train de vie", kv([
    ["Revenus nets du client par mois", eur(num(pr.revenus_nets_mois))], ["Revenus du conjoint par mois", eur(num(pr.revenus_conjoint_mois))], ["Dividendes par an", eur(num(pr.dividendes_an))],
    ["Autres revenus par an", eur(num(pr.autres_revenus_an))], ["Revenus exceptionnels par an (exclus des calculs)", eur(num(pr.revenus_exceptionnels_an))]]) +
    `<h3>Charges du foyer par mois</h3>` + table(["Catégorie", "Montant"], CATEGORIES_CHARGES.map(([k, l]) => [esc(l), eur(num(c.charges?.[k]))]), [1]) +
    kv([["Capacité d'épargne théorique par mois", eur(flux.capaciteEpargneTheorique)], ["Épargne réellement constatée par mois", eur(flux.epargneReelle)]])));
  annexes.push(page("Annexe C — Patrimoine", "Patrimoine financier, immobilier et passif", `<h3>Patrimoine financier</h3>` + table(["Poste", "Montant"], Object.entries(fin).map(([k, v]) => [esc(k.replace(/_/g, " ")), eur(num(v))]), [1]) +
    `<h3>Fiche économique des biens (avant impôt)</h3>` + table(["Bien", "Prix d'achat", "Valeur", "Rendement net", "Fonds propres", "Valeur nette", "Plus-value latente", "Effort d'épargne"],
      arr(pat.lots).map((l, i) => { const b = analyserBien(l); return [esc(l.adresse || `Bien ${i + 1}`), eur(num(l.valeur_acquisition)), eur(num(l.valeur)), pc1(b.rendementNet), pc1(b.rentabiliteFondsPropres), eur(b.valeurNette), eur(b.plusValueLatente), eur(b.effortEpargneMois)]; }), [1, 2, 3, 4, 5, 6, 7]) +
    `<h3>Autres dettes</h3>` + table(["Type", "Capital restant", "Mensualité", "Taux", "Garantie"], arr(c.dettes).map((d) => [esc(d.type || "—"), eur(num(d.capital_restant)), eur(num(d.mensualite)), d.taux ? `${esc(d.taux)} %` : "—", esc(d.garantie || "—")]), [1, 2]) +
    `<p class="muted">Résidence principale : valeur ${eur(num(pat.rp_valeur))}, capital restant dû ${eur(num(pat.rp_crd))}. Dettes hors immobilier locatif : ${eur(analyserDettes(c.dettes).capitalRestant)}.</p>`));
  annexes.push(page("Annexe D — Fiscalité et banque", "Situation fiscale et bancaire", kv([
    ["Tranche marginale d'imposition", texte(pr.tmi)], ["IFI", texte(pr.ifi)], ["Impôt sur le revenu N-1", eur(num(pr.impot_revenu))], ["Régime locatif actuel", texte(pr.regime_locatif)], ["Déficits, dispositifs reportables", texte(pr.dispositifs_fiscaux)],
    ["Banque principale", texte(c.financement?.banque_principale)], ["Apport disponible", eur(num(c.financement?.apport_disponible))], ["Situation bancaire", texte(c.qualification?.situation_bancaire)]]) +
    `<h3>Profil investisseur immobilier (${analyserProfilImmo(c.profil_immo).renseignees}/${DIMENSIONS_PROFIL_IMMO.length})</h3>` + table(["Critère", "Réponse"], DIMENSIONS_PROFIL_IMMO.map(([k, l]) => [esc(l), texte(c.profil_immo?.[k])]))));
  annexes.push(page("Annexe E — Analyses", "Analyses du conseiller", kv([
    ["Performance des actifs", texte(a.analyse_performance)], ["Situation bancaire", texte(a.analyse_bancaire)], ["Fiscalité", texte(a.analyse_fiscale)],
    ["Structure de détention", texte(a.analyse_structure)], ["Transmission", texte(a.analyse_transmission)], ["Risques", texte(a.analyse_risques)]]) +
    `<h3>Préconisations</h3>` + table(["Axe", "Priorité", "Préconisation", "Action"], arr(a.preconisations).filter((r) => String(r.titre || "").trim()).map((r) => [esc(r.axe || "—"), esc(r.priorite || "—"), `<b>${esc(r.titre)}</b><br>${esc(r.detail || "")}`, esc(r.action || "—")]))));

  if (structures && structures.structures.length) {
    annexes.push(page("Annexe F — Structures", "Comparaison détaillée des structures de détention", table(["", ...structures.structures.map((x) => x.libelle)], [
      ["Régime retenu", ...structures.structures.map((x) => esc(x.libelleRegime))], ["Frais à l'entrée", ...structures.structures.map((x) => eur(x.entree.frais))],
      ["Impôt de l'année 1", ...structures.structures.map((x) => eur(x.annuel.impotAnnee1))], ["Impôt annuel moyen", ...structures.structures.map((x) => eur(x.annuel.impotMoyen))],
      ["Cash-flow annuel moyen après impôt", ...structures.structures.map((x) => eur(x.annuel.cashApresImpotMoyen))], ["Plus-value à la sortie", ...structures.structures.map((x) => eur(x.sortie.plusValue))],
      ["Impôts de sortie", ...structures.structures.map((x) => eur(x.sortie.impotSortie))], ["<b>Gain net total</b>", ...structures.structures.map((x) => `<b>${eur(x.gainNet)}</b>`)],
      ["Complexité", ...structures.structures.map((x) => esc(x.complexite.niveau))]], structures.structures.map((_, i) => i + 1)) +
      structures.structures.map((x) => `<p><b>${esc(x.libelle)}</b> — ${esc(x.complexite.texte)}<br><span class="muted">Sortie : ${esc(x.sortie.detail)}</span>${x.alertes.map((m) => `<br><span class="warn">${esc(m)}</span>`).join("")}</p>`).join("") +
      structures.avertissements.map((m) => `<p class="muted">${esc(m)}</p>`).join("")));
  }

  const hGlob = { ...HYPOTHESES_GLOBALES_PAR_DEFAUT, ...(surcharges.globales || {}) };
  const hStr = { ...HYPOTHESES_STRUCTURES_PAR_DEFAUT, ...(data?.parametres_structures || {}) };
  const valeurHyp = (cas, k) => (num(surcharges.parCas?.[cas]?.[k]) ?? HYPOTHESES_CAS_PAR_DEFAUT[cas][k]);
  annexes.push(page("Annexe G — Hypothèses", "Hypothèses utilisées", `<p>Les projections reposent sur les hypothèses suivantes. Ce sont des valeurs de départ choisies par prudence, pas des données de marché ; elles ont été discutées avec le client et peuvent être modifiées.</p>` +
    table(["Hypothèse", ...CAS.map((k) => LIBELLES_CAS[k])], Object.keys(LIBELLES_HYPOTHESES).map((k) => [esc(LIBELLES_HYPOTHESES[k]), ...CAS.map((cas) => esc(valeurHyp(cas, k)))]), [1, 2, 3]) +
    kv([["Taux des crédits", `${esc(hGlob.tauxCredit)} %`], ["Assurance emprunteur", `${esc(hGlob.assuranceEmprunteur)} % par an`], ["Charges d'une opération", `${esc(hGlob.chargesOperationPct)} % des loyers`],
      ["Durée résiduelle du prêt de la résidence principale", `${esc(hGlob.dureeResiduelleRP)} ans`], ["Plafond d'endettement", `${esc(hyp.plafondEndettement)} %`], ["Loyers retenus par la banque", `${esc(hyp.loyersRetenusBanque)} %`],
      ["Frais d'acquisition", `${esc(hStr.fraisAcquisitionPct)} %`], ["Amortissement", `${esc(hStr.dureeAmortissement)} ans, terrain ${esc(hStr.terrainPct)} % non amortissable`]]) +
    `<h3>Limites du modèle</h3><ul>${limites.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`));

  const aValider = [
    "Transmission du patrimoine (donation de parts, démembrement, protection du conjoint, régime matrimonial) : notaire.",
    "Choix de la structure de détention et régime fiscal (SCI à l'IR ou à l'IS, meublé, micro ou réel) : expert-comptable, avec le notaire pour les actes.",
    "Capacité d'emprunt, taux et conditions de financement : banque ou courtier.",
    ...sw.risques.filter((x) => /notaire|expert-comptable/i.test(x.detail)).map((x) => `${x.titre} : ${x.detail}`),
    ...(structures ? structures.structures.flatMap((x) => x.alertes) : []),
  ];
  annexes.push(page("Annexe H — Validations", "Points nécessitant une validation externe", `<p>Cette étude est un travail d'analyse et d'aide à la décision. Elle ne remplace pas les professionnels suivants, dont l'avis est nécessaire avant toute mise en œuvre :</p><ul>${[...new Set(aValider)].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="note">Quotient familial, surtaxe sur les plus-values élevées, IFI, dispositifs fiscaux particuliers, CFE et TVA ne sont pas modélisés.</div>`));

  const pages = niveau === "complet" ? [...synthese, ...annexes] : synthese;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(clientNom)} — Étude patrimoniale</title><style>${CSS}</style></head><body><div class="no-print"><button class="btn" onclick="window.print()">Imprimer / PDF</button></div>${pages.join("")}</body></html>`;
}
