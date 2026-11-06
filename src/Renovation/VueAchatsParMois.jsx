// Vue « Par mois d'achat » de la page Encours fournisseurs.
// La page ne fait que CHARGER et AFFICHER : tout le calcul (mois retenu, montant
// retenu, répartition par chantier, signal « absent de la facture ») vit dans
// achatsParMois.mjs (module pur, couvert par scripts/verif-achats-par-mois.mjs).
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC, LOGO_RENO_H } from "../constants";
import { Icon } from "../ui";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { regrouperAchatsParMois, chantiersDesAchats, A_AFFECTER } from "./achatsParMois.js";
import { buildAchatsMoisDocHTML } from "./encoursDoc";
import { chargerChantiers } from "./chantiersDonnees";

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const moisLabel = (ym) => {
  if (!ym || ym.length < 7 || ym === "____") return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
};
const eur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFR = (iso) => { const d = iso ? new Date(iso + "T00:00:00") : null; return d && !isNaN(d.getTime()) ? d.toLocaleDateString("fr-FR") : ""; };
const LIB_TYPE = { bl: "BL", ticket: "Ticket", bon_commande: "Bon de commande" };
export const docAchatLabel = (d) => {
  const n = d.numero ? ` n° ${d.numero}` : "";
  if (d.kind === "frais") return `${d.libelle || "Frais"} · facture${n}`;
  if (d.kind === "avoir") return `Avoir${n}`;
  if (d.kind === "facture_directe") return `Facture${n} (sans BL)`;
  if (d.kind === "bl_non_saisi") return `BL${n} · sur facture, non saisi`;
  return `${LIB_TYPE[d.type] || "Document"}${n}`;
};
const lirePref = (k, def) => { try { return localStorage.getItem(k) || def; } catch { return def; } };
const ecrirePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } };

// Pagination simple : PostgREST plafonne une réponse, on lit par pages de 1000.
async function toutLire(construire) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await construire().range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

export default function VueAchatsParMois({ T, acc, entete }) {
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState("");
  const [donnees, setDonnees] = useState(null);
  const [nomsChantiers, setNomsChantiers] = useState({});
  const [fFilter, setFFilter] = useState("");
  const [chFilter, setChFilter] = useState("");
  const [statut, setStatut] = useState("tout");
  const [sousVue, setSousVue] = useState(() => lirePref("achatsMois.sousVue", "fournisseur"));
  const [ouverts, setOuverts] = useState({});
  const [fournOuverts, setFournOuverts] = useState({});
  const moisCourant = new Date().toLocaleDateString("sv-SE").slice(0, 7);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [fournisseurs, commandes, lignes, factures, factureBl, facturesFrais, avoirs] = await Promise.all([
          toutLire(() => supabase.from("fournisseurs").select("id, nom, type_facturation, regles_numero").order("id")),
          toutLire(() => supabase.from("commandes")
            .select("id, fournisseur_id, fournisseur_nom, doc_type, doc_numero, montant_ht, date_doc, created_at, statut_facturation, facture_id, source, remplace_par_id")
            .order("id")),
          toutLire(() => supabase.from("commande_lignes").select("id, commande_id, chantier_id, prix_total").order("id")),
          toutLire(() => supabase.from("factures")
            .select("id, numero, fournisseur_id, fournisseur_nom, montant_ht, frais_ht, date_facture, periode, created_at, statut, type_document")
            .order("id")),
          toutLire(() => supabase.from("facture_bl").select("id, facture_id, commande_id, bl_numero, montant_ht, statut, date_livraison").order("id")),
          toutLire(() => supabase.from("facture_frais").select("id, facture_id, libelle, montant_ht, chantier_id").order("id")),
          toutLire(() => supabase.from("avoirs_fournisseurs_imputations").select("id, facture_id, chantier_id, montant_ht").order("id")),
        ]);
        setDonnees({ fournisseurs, commandes, lignes, factures, factureBl, facturesFrais, avoirs, moisCourant });
        setErreur("");
      } catch (e) {
        setErreur(e?.message || String(e));
      }
      setLoading(false);
    })();
    chargerChantiers({ inclureArchives: true })
      .then(liste => { const m = {}; liste.forEach(c => { m[String(c.id)] = c.nom || String(c.id); }); setNomsChantiers(m); })
      .catch(() => {});
  }, [moisCourant]);

  const nomChantier = (id) => (id == null ? "À affecter" : (nomsChantiers[id] || id));
  const tous = useMemo(() => (donnees ? regrouperAchatsParMois(donnees) : []), [donnees]);
  const moisList = useMemo(
    () => (donnees ? regrouperAchatsParMois(donnees, { fournisseur: fFilter, chantier: chFilter, statut }) : []),
    [donnees, fFilter, chFilter, statut],
  );
  const fournisseurs = useMemo(() => [...new Set(tous.flatMap(g => g.parFournisseur.map(f => f.nom)))].sort((a, b) => a.localeCompare(b)), [tous]);
  const chantiers = useMemo(() => (donnees ? chantiersDesAchats(donnees) : [])
    .filter(id => id != null)
    .sort((a, b) => nomChantier(a).localeCompare(nomChantier(b))), [donnees, nomsChantiers]); // eslint-disable-line react-hooks/exhaustive-deps
  const mc = moisList.find(g => g.mois === moisCourant) || { achete: 0, facture: 0, enAttente: 0 };
  const filtreActif = !!(fFilter || chFilter || statut !== "tout");

  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, marginBottom: SPACING.sm };
  const labelStyle = { display: "block", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSub, marginBottom: 6 };
  const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, color: T.text, fontSize: 15, fontFamily: "inherit", outline: "none" };
  const badge = (texte, couleur) => (
    <span style={{ fontSize: 10, fontWeight: 800, color: couleur, textTransform: "uppercase", letterSpacing: 0.4 }}>{texte}</span>
  );
  const badgesDoc = (d) => {
    const b = [];
    if (d.absentFacture) b.push({ texte: "absent de la facture", couleur: SEMANTIC.danger.color });
    if (d.ecart) b.push({ texte: `écart ${d.ecart > 0 ? "+" : ""}${eur(d.ecart)} € (saisi ${eur(d.saisi)} €)`, couleur: SEMANTIC.warning.color });
    if (d.kind === "avoir") b.push({ texte: "avoir", couleur: SEMANTIC.success.color });
    else if (d.facture) b.push({ texte: "facturé", couleur: SEMANTIC.success.color });
    else b.push({ texte: "en attente", couleur: SEMANTIC.warning.color });
    return b;
  };

  const exporterPDF = async () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
    const html = buildAchatsMoisDocHTML({
      mois: moisList.map(g => ({
        label: moisLabel(g.mois), nbDocs: g.nbDocs, achete: g.achete, facture: g.facture, enAttente: g.enAttente,
        fournisseurs: g.parFournisseur.map(pf => ({
          nom: pf.nom, achete: pf.achete, facture: pf.facture, enAttente: pf.enAttente, ecart: pf.ecart, absentFacture: pf.absentFacture,
          docs: pf.docs.map(d => ({ libelle: docAchatLabel(d), date: dateFR(d.date), montant: d.montant, badges: badgesDoc(d) })),
        })),
        chantiers: g.parChantier.map(c => ({ nom: nomChantier(c.chantierId), aAffecter: c.chantierId == null, achete: c.achete, facture: c.facture, enAttente: c.enAttente })),
      })),
      moisCourant: { label: moisLabel(moisCourant), achete: mc.achete, facture: mc.facture, enAttente: mc.enAttente },
      filtres: [
        fFilter ? `Fournisseur : ${fFilter}` : "Tous les fournisseurs",
        chFilter ? `Chantier : ${chFilter === A_AFFECTER ? "À affecter" : nomChantier(chFilter)}` : "",
        statut === "facture" ? "Facturés seulement" : statut === "en_attente" ? "En attente de facture seulement" : "",
      ],
      logoUrl: `${window.location.origin}${LOGO_RENO_H}`,
      dateGen: new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
        + " à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    });
    w.document.open(); w.document.write(html); w.document.close();
    w.document.title = `AchatsParMois-${new Date().toLocaleDateString("sv-SE")}`;
    await new Promise((res) => {
      const debut = Date.now();
      const tick = () => {
        const imgs = Array.from(w.document.images || []);
        if ((w.document.readyState === "complete" && imgs.every(i => i.complete)) || Date.now() - debut > 8000) res();
        else setTimeout(tick, 150);
      };
      tick();
    });
    try { await (w.document.fonts?.ready || Promise.resolve()); } catch { /* repli Arial */ }
    setTimeout(() => { w.focus(); w.print(); }, 200);
  };

  const montantCol = (label, val, color) => (
    <div key={label} style={{ textAlign: "right", minWidth: 76 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSub }}>{label}</div>
      <div style={{ fontSize: FONT.md.size, fontWeight: 800, whiteSpace: "nowrap", color: val !== 0 ? color : T.textMuted }}>{eur(val)} €</div>
    </div>
  );
  const btnOnglet = (actif) => ({
    padding: "6px 12px", borderRadius: RADIUS.md, border: `1px solid ${actif ? acc.accent : T.border}`,
    background: actif ? acc.bg10 : "transparent", color: actif ? acc.accent : T.textSub,
    fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
  });

  return (
    <>
      {entete({ sousTitre: "Chaque achat est rangé au mois où il a été commandé ou acheté, et non au mois où on le paie", onPDF: exporterPDF })}

      <div style={{ display: "flex", gap: SPACING.sm, marginBottom: SPACING.md, flexWrap: "wrap" }}>
        {[
          { label: `Acheté · ${moisLabel(moisCourant)}`, val: mc.achete, color: T.text },
          { label: "dont facturé", val: mc.facture, color: SEMANTIC.success.color },
          { label: "dont en attente de facture", val: mc.enAttente, color: SEMANTIC.warning.color },
        ].map(t => (
          <div key={t.label} style={{ ...card, flex: 1, minWidth: 140, marginBottom: 0, padding: "12px 14px" }}>
            <div style={labelStyle}>{t.label}</div>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: t.color }}>{eur(t.val)} €</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: SPACING.sm, marginBottom: SPACING.md, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle}>Fournisseur</label>
          <select value={fFilter} onChange={e => setFFilter(e.target.value)} style={inputStyle}>
            <option value="">Tous les fournisseurs</option>
            {fournisseurs.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle}>Chantier</label>
          <select value={chFilter} onChange={e => setChFilter(e.target.value)} style={inputStyle}>
            <option value="">Tous les chantiers</option>
            <option value={A_AFFECTER}>À affecter (sans chantier)</option>
            {chantiers.map(id => <option key={id} value={id}>{nomChantier(id)}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle}>Statut</label>
          <select value={statut} onChange={e => setStatut(e.target.value)} style={inputStyle}>
            <option value="tout">Tout</option>
            <option value="facture">Facturé</option>
            <option value="en_attente">En attente de facture</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textSub }}><Icon as={Loader2} size={24} className="spin" /> Chargement…</div>
      ) : erreur ? (
        <div style={{ ...card, color: SEMANTIC.danger.color, padding: 16 }}>Impossible de charger les achats : {erreur}</div>
      ) : moisList.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: T.textSub, padding: 30 }}>
          {filtreActif ? "Aucun achat ne correspond à ces filtres." : "Aucun achat enregistré."}
        </div>
      ) : (
        moisList.map(g => {
          const ouvert = ouverts[g.mois] ?? filtreActif;
          return (
            <div key={g.mois} style={card}>
              <button onClick={() => setOuverts(o => ({ ...o, [g.mois]: !ouvert }))} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
                background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}>
                <Icon as={ouvert ? ChevronDown : ChevronRight} size={16} color={T.textSub} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px 16px", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 140px" }}>
                    <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: T.text, textTransform: "capitalize" }}>{moisLabel(g.mois)}</div>
                    <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>
                      {g.nbDocs} document{g.nbDocs > 1 ? "s" : ""}
                      {g.parFournisseur.some(f => f.absentFacture) && <> · {badge("absent de la facture", SEMANTIC.danger.color)}</>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginLeft: "auto" }}>
                    {montantCol("Acheté", g.achete, T.text)}
                    {montantCol("Facturé", g.facture, SEMANTIC.success.color)}
                    {montantCol("En attente", g.enAttente, SEMANTIC.warning.color)}
                  </div>
                </div>
              </button>

              {ouvert && (
                <div style={{ borderTop: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", gap: 6, padding: "10px 16px 6px 40px" }}>
                    <button style={btnOnglet(sousVue === "fournisseur")} onClick={() => { setSousVue("fournisseur"); ecrirePref("achatsMois.sousVue", "fournisseur"); }}>Par fournisseur</button>
                    <button style={btnOnglet(sousVue === "chantier")} onClick={() => { setSousVue("chantier"); ecrirePref("achatsMois.sousVue", "chantier"); }}>Par chantier</button>
                  </div>

                  {sousVue === "chantier" ? g.parChantier.map(c => (
                    <div key={c.chantierId ?? "aff"} style={{ padding: "10px 16px 10px 40px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: FONT.base.size, fontWeight: 600, color: c.chantierId == null ? SEMANTIC.warning.color : T.text }}>{nomChantier(c.chantierId)}</div>
                        <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 1 }}>
                          {[c.facture ? `Facturé ${eur(c.facture)} €` : "", c.enAttente ? `En attente ${eur(c.enAttente)} €` : ""].filter(Boolean).join("  ·  ")}
                        </div>
                      </div>
                      <div style={{ fontSize: FONT.base.size, fontWeight: 800, minWidth: 96, textAlign: "right", fontFamily: "'DM Mono', monospace", color: T.text }}>{eur(c.achete)} €</div>
                    </div>
                  )) : g.parFournisseur.map(pf => {
                    const cle = `${g.mois}|${pf.nom}`;
                    const fOuvert = fournOuverts[cle] ?? !!fFilter;
                    return (
                      <div key={pf.nom} style={{ padding: "10px 16px 10px 40px", borderBottom: `1px solid ${T.border}` }}>
                        <button onClick={() => setFournOuverts(o => ({ ...o, [cle]: !fOuvert }))} style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 0,
                          background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                        }}>
                          <Icon as={fOuvert ? ChevronDown : ChevronRight} size={14} color={T.textSub} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: FONT.base.size, fontWeight: 600, color: T.text }}>
                              {pf.nom} {pf.absentFacture && badge("absent de la facture", SEMANTIC.danger.color)}
                            </div>
                            <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 1 }}>
                              {[`${pf.nbDocs} doc.`, pf.facture ? `Facturé ${eur(pf.facture)} €` : "", pf.enAttente ? `En attente ${eur(pf.enAttente)} €` : ""].filter(Boolean).join("  ·  ")}
                            </div>
                            {pf.ecart !== 0 && (
                              <div style={{ fontSize: FONT.xs.size, fontWeight: 700, marginTop: 1, color: SEMANTIC.warning.color }}>
                                écart facturé − saisi : {pf.ecart > 0 ? "+" : ""}{eur(pf.ecart)} €
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: FONT.base.size, fontWeight: 800, minWidth: 96, textAlign: "right", fontFamily: "'DM Mono', monospace", color: T.text }}>{eur(pf.achete)} €</div>
                        </button>
                        {fOuvert && (
                          <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${T.border}` }}>
                            {pf.docs.map(d => (
                              <div key={d.id} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", flexWrap: "wrap" }}>
                                <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textSub }}>{docAchatLabel(d)}</span>
                                {d.date && <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{dateFR(d.date)}</span>}
                                {badgesDoc(d).map(b => <span key={b.texte}>{badge(b.texte, b.couleur)}</span>)}
                                <span style={{ flex: 1 }} />
                                <span style={{ fontSize: FONT.xs.size, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: T.textSub }}>{eur(d.montant)} €</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
