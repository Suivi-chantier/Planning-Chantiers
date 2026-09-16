// ─────────────────────────────────────────────────────────────────────────────
// « LOGEMENTS / DEVIS ProGBat » — rattachement explicite d'un ou plusieurs
// logements (profero_projets) au chantier affiché.
//
// POURQUOI CE BLOC EXISTE : une facture ProGBat porte un `quoteId`, et
// progbat_quote_exports sait à quel logement ce devis appartient. Ce qu'aucune
// donnée ne dit, c'est à quel CHANTIER ce logement se rattache — un immeuble
// se chiffre logement par logement. Ce rattachement est donc posé ici, à la
// main, une fois pour toutes. Rien n'est jamais rattaché automatiquement : deux
// T3 d'un même immeuble partagent client et adresse, un rapprochement par
// ressemblance se tromperait en silence.
//
// La liste proposée vient de la fonction progbat_devis_exportables() : seuls
// les logements ayant un devis RÉELLEMENT créé dans ProGBat (identifiant connu)
// apparaissent. progbat_quote_exports reste fermée au navigateur.
//
// Un logement ne peut appartenir qu'à un seul chantier : c'est une contrainte
// de base (chantier_projets_projet_unique), rappelée ici avant même la
// tentative d'écriture pour que le refus soit lisible.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Home, Plus, X, Loader2, AlertTriangle, Link2, Check } from "lucide-react";

const jj = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

// Libellé d'un logement : ce qu'on a de plus parlant, sans rien inventer.
const libelleProjet = (p) => {
  if (!p) return "Logement inconnu";
  const client = [p.client_nom, p.client_prenom].filter(Boolean).join(" ").trim();
  const lieu = p.logement_reference
    || [p.chantier_adresse || p.adresse_bien, p.chantier_ville].filter(Boolean).join(", ");
  return [client || "Sans client", lieu].filter(Boolean).join(" — ");
};

export default function ChantierProjetsProgbat({ chantierId, chantiers = [], T, peutModifier = true }) {
  const [etat, setEtat] = useState({ charge: false, erreur: "" });
  const [devis, setDevis] = useState([]);       // progbat_devis_exportables()
  const [liens, setLiens] = useState([]);       // chantier_projets (TOUS les chantiers)
  const [projets, setProjets] = useState({});   // { [id]: ligne profero_projets }
  const [ajout, setAjout] = useState("");       // projet_id choisi dans la liste
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const border = T?.border || "rgba(255,255,255,0.07)";
  const text = T?.text || "#f0f0f0";
  const textSub = T?.textSub || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // Les liens de TOUS les chantiers sont chargés, pas seulement ceux de
  // celui-ci : c'est ce qui permet de dire « déjà rattaché au chantier X »
  // avant de tenter une écriture vouée à être refusée.
  const charger = useCallback(async () => {
    if (!chantierId) return;
    setEtat({ charge: false, erreur: "" });
    const [rd, rl] = await Promise.all([
      supabase.rpc("progbat_devis_exportables"),
      supabase.from("chantier_projets").select("id, chantier_id, projet_id, created_at"),
    ]);
    if (rd.error && rl.error) {
      setEtat({ charge: true, erreur: "Rattachements indisponibles : la migration sql/202609_chantier_projets.sql n'a peut-être pas encore été lancée." });
      return;
    }
    const lignesDevis = rd.error ? [] : (rd.data || []);
    const lignesLiens = rl.error ? [] : (rl.data || []);
    setDevis(lignesDevis);
    setLiens(lignesLiens);

    // Libellés : uniquement les logements concernés (devis exportables + déjà
    // rattachés à CE chantier), jamais toute la table.
    const ids = [...new Set([
      ...lignesDevis.map(d => d.projet_id),
      ...lignesLiens.filter(l => l.chantier_id === chantierId).map(l => l.projet_id),
    ].filter(Boolean))];
    let map = {};
    if (ids.length) {
      const { data } = await supabase.from("profero_projets")
        .select("id, client_nom, client_prenom, logement_reference, adresse_bien, chantier_adresse, chantier_ville")
        .in("id", ids);
      (data || []).forEach(p => { map[p.id] = p; });
    }
    setProjets(map);
    setEtat({
      charge: true,
      erreur: rd.error
        ? "Liste des devis ProGBat indisponible (fonction progbat_devis_exportables absente ?)."
        : rl.error ? "Rattachements indisponibles (table chantier_projets absente ?)." : "",
    });
  }, [chantierId]);

  useEffect(() => { charger(); }, [charger]);

  const nomChantier = (id) => chantiers.find(c => String(c.id) === String(id))?.nom || id;
  const devisDuProjet = (projetId) => devis.filter(d => d.projet_id === projetId);

  const rattaches = liens.filter(l => l.chantier_id === chantierId);
  const prisAilleurs = new Map(
    liens.filter(l => l.chantier_id !== chantierId).map(l => [l.projet_id, l.chantier_id]),
  );
  // Logements proposables : un devis ProGBat exploitable, et pas déjà rattaché
  // à ce chantier. Ceux pris ailleurs restent visibles, mais désactivés : c'est
  // plus utile que de les cacher (on comprend pourquoi ils manquent).
  const dejaIci = new Set(rattaches.map(l => l.projet_id));
  const proposables = [...new Set(devis.map(d => d.projet_id))]
    .filter(id => id && !dejaIci.has(id))
    .map(id => ({ id, pris: prisAilleurs.get(id) || null }))
    .sort((a, b) => libelleProjet(projets[a.id]).localeCompare(libelleProjet(projets[b.id])));

  const rattacher = async () => {
    if (!ajout || busy) return;
    if (prisAilleurs.has(ajout)) {
      setMessage(`Ce logement est déjà rattaché au chantier « ${nomChantier(prisAilleurs.get(ajout))} ». Détachez-le d'abord.`);
      return;
    }
    setBusy(true); setMessage("");
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("chantier_projets").insert({
      chantier_id: chantierId,
      projet_id: ajout,
      cree_par: user?.id || null,
      cree_par_email: user?.email || null,
    });
    setBusy(false);
    if (error) {
      // 23505 = contrainte d'unicité : le logement a été rattaché ailleurs
      // entre le chargement de l'écran et le clic.
      setMessage(error.code === "23505"
        ? "Ce logement vient d'être rattaché à un autre chantier."
        : `Rattachement impossible : ${error.message}`);
      return;
    }
    setAjout("");
    await charger();
  };

  const detacher = async (lien) => {
    const nom = libelleProjet(projets[lien.projet_id]);
    if (!window.confirm(`Détacher « ${nom} » de ce chantier ?\n\nLes factures ProGBat de ce logement ne seront plus rattachées à ce chantier.`)) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.from("chantier_projets").delete().eq("id", lien.id);
    setBusy(false);
    if (error) { setMessage(`Détachement impossible : ${error.message}`); return; }
    await charger();
  };

  const selectStyle = {
    flex: "1 1 240px", minWidth: 180, padding: "7px 10px", borderRadius: RADIUS.md,
    border: `1px solid ${border}`, background: T?.inputBg || "transparent", color: text,
    fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none",
  };

  return (
    <div style={{ flex: "1 1 100%", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8,
        fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2,
        textTransform: "uppercase", color: textMuted,
      }}>
        <Icon as={Home} size={11}/> Logements / devis ProGBat
        <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", opacity: .75 }}>
          — ce qui permet de reconnaître à quel chantier appartient une facture ProGBat
        </span>
      </div>

      {etat.erreur && (
        <div style={{
          display: "flex", gap: 8, padding: "9px 12px", marginBottom: 10, borderRadius: RADIUS.md,
          background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)",
          fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600,
        }}>
          <Icon as={AlertTriangle} size={13} style={{ flexShrink: 0, marginTop: 1 }}/>{etat.erreur}
        </div>
      )}

      {!etat.charge ? (
        <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon as={Loader2} size={12}/> Chargement des rattachements…
        </div>
      ) : (
        <>
          {/* Logements rattachés */}
          {rattaches.length === 0 ? (
            <div style={{
              padding: "11px 13px", borderRadius: RADIUS.lg, border: `1px dashed ${border}`,
              fontSize: FONT.xs.size + 1, color: textMuted, lineHeight: 1.6,
            }}>
              Aucun logement rattaché à ce chantier. Tant qu'aucun rattachement n'est fait, les factures
              ProGBat de ces logements ne peuvent pas être reconnues automatiquement — elles devront être
              rattachées à la main.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {rattaches.map(l => {
                const ds = devisDuProjet(l.projet_id);
                return (
                  <div key={l.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 9,
                    padding: "9px 11px", borderRadius: RADIUS.lg, border: `1px solid ${border}`,
                  }}>
                    <Icon as={Link2} size={13} color="#22c55e" style={{ flexShrink: 0, marginTop: 2 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: text }}>
                        {libelleProjet(projets[l.projet_id])}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        {ds.length === 0 ? (
                          <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
                            Aucun devis ProGBat exportable pour ce logement.
                          </span>
                        ) : ds.map(d => (
                          <span key={d.progbat_quote_id} title={d.exporte_le ? `Exporté le ${jj(d.exporte_le)}` : undefined}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              border: `1px solid ${border}`, borderRadius: RADIUS.pill, padding: "1px 9px",
                              fontSize: FONT.xs.size + 1, color: textSub,
                            }}>
                            devis n° {d.progbat_quote_id}
                            {d.progbat_quote_code ? ` · ${d.progbat_quote_code}` : ""}
                            {d.statut === "uncertain" && (
                              <span style={{ color: "#f59e0b", fontWeight: 700 }}>état incertain</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    {peutModifier && (
                      <button onClick={() => detacher(l)} disabled={busy} title="Détacher ce logement du chantier"
                        style={{
                          background: "transparent", border: `1px solid ${border}`, borderRadius: RADIUS.md,
                          padding: "3px 8px", color: textMuted, cursor: busy ? "default" : "pointer",
                          fontFamily: "inherit", display: "inline-flex", alignItems: "center", flexShrink: 0,
                        }}><Icon as={X} size={11}/></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Rattacher un logement */}
          {peutModifier && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <select value={ajout} onChange={e => { setAjout(e.target.value); setMessage(""); }}
                disabled={busy || proposables.length === 0} style={selectStyle}>
                <option value="">
                  {proposables.length === 0
                    ? "Aucun autre logement avec un devis ProGBat"
                    : "Choisir un logement à rattacher…"}
                </option>
                {proposables.map(({ id, pris }) => {
                  const ds = devisDuProjet(id);
                  const ref = ds.map(d => `n° ${d.progbat_quote_id}`).join(", ");
                  return (
                    <option key={id} value={id} disabled={!!pris}>
                      {libelleProjet(projets[id])}{ref ? ` — devis ${ref}` : ""}
                      {pris ? ` — déjà sur « ${nomChantier(pris)} »` : ""}
                    </option>
                  );
                })}
              </select>
              <button onClick={rattacher} disabled={!ajout || busy} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
                background: !ajout || busy ? border : "#22c55e",
                color: !ajout || busy ? textMuted : "#fff",
                fontSize: FONT.xs.size + 1, fontWeight: 800,
                cursor: !ajout || busy ? "default" : "pointer", fontFamily: "inherit",
              }}>
                <Icon as={busy ? Loader2 : Plus} size={12}/>{busy ? "Enregistrement…" : "Rattacher"}
              </button>
            </div>
          )}

          {message && (
            <div style={{
              marginTop: 8, display: "flex", gap: 7, fontSize: FONT.xs.size + 1,
              color: message.startsWith("Rattachement impossible") || message.includes("déjà") ? "#e15a5a" : textSub,
              fontWeight: 600,
            }}>
              <Icon as={message.includes("déjà") ? AlertTriangle : Check} size={12} style={{ flexShrink: 0, marginTop: 2 }}/>
              {message}
            </div>
          )}
        </>
      )}
    </div>
  );
}
