// ─────────────────────────────────────────────────────────────────────────────
// Bloc « Client, chargé d'affaires et statuts » de la fiche Opération
// (Refonte Opérations, lot 2).
//
//   - statut de l'opération, CALCULÉ depuis ses chantiers (statutOperation) ;
//   - client et chargé d'affaires de l'opération : valeurs par défaut de ses
//     chantiers ;
//   - pour chaque chantier : statut, client et chargé d'affaires (vide =
//     « comme l'opération »), « Marquer perdu » / « Annuler perdu ».
// Opérations est la seule page (avec les listes complètes) où un chantier À
// l'étude ou Perdu reste visible.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { UserCircle, Pencil } from "lucide-react";
import {
  statutOperation, statutAffiche, peutMarquerPerdu, estChantierPerdu,
  preparerPerte, preparerAnnulationPerte, clientEffectif, chargeAffairesEffectif,
} from "./statutsChantier.js";
import { chargerClients, chargerCollaborateurs, libelleClient } from "./clientsDonnees.js";
import { journaliserStatut, modifierOperationCommercial } from "./chantiersDonnees.js";
import {
  BadgeStatut, FicheClientModal, ChoixClient, ChoixChargeAffaires, MarquerPerduModal, AnnulerPerteModal, ResumePerte,
  ListeManquants,
} from "./ComposantsCommerciaux.jsx";
import { ChoixClientProgbatModal, NoteClientProgbat, useRelectureAutoProgbat } from "./ClientsProgbat.jsx";
import { controlerFiche } from "./reglesSaisieProgbat.js";

export default function OperationCommercial({ T, op, chantiersOp = [], chantiers = [], setChantiers, saveConfig, profil, onOperationModifiee }) {
  const [clients, setClients] = useState([]);
  const [erreurClients, setErreurClients] = useState(null);
  const [collab, setCollab] = useState({ collaborateurs: [], complete: true });
  const [ficheClient, setFicheClient] = useState(null);   // { cible: "operation" | chantierId, client? }
  const [perte, setPerte] = useState(null);               // { mode: "perdu" | "annuler", chantier }
  const [choixProgbat, setChoixProgbat] = useState(null); // { cible: "operation" | chantierId } — lot 4
  const [infoProgbat, setInfoProgbat] = useState(null);   // message après choix d'un client ProGBat
  const peutModifier = !!(setChantiers && saveConfig);
  const border = T.border, text = T.text, textSub = T.textSub, textMuted = T.textMuted;

  useEffect(() => {
    let actif = true;
    chargerClients().then((r) => { if (actif) { setClients(r.clients); setErreurClients(r.erreur); } });
    chargerCollaborateurs().then((r) => { if (actif) setCollab(r); });
    return () => { actif = false; };
  }, []);

  const statutOp = useMemo(() => statutOperation(chantiersOp), [chantiersOp]);
  const clientParId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const clientOp = op.client_id ? clientParId.get(op.client_id) : null;
  const auteur = profil?.nom || profil?.email || "";
  // Demande de Loris du 07/11 : une fiche reliée à ProGBat et incomplète est
  // relue automatiquement (champs vides complétés, rien d'écrasé).
  const remplacerClient = (client) => setClients((l) => [...l.filter((c) => c.id !== client.id), client]);
  useRelectureAutoProgbat([clientOp, ...chantiersOp.map((c) => (c.client_id ? clientParId.get(c.client_id) : null))], remplacerClient);

  const majChantier = async (chantierId, champs) => {
    const u = chantiers.map((c) => (c.id === chantierId ? { ...c, ...champs } : c));
    setChantiers(u);
    await saveConfig("chantiers", u);
  };
  const majOperation = async (patch) => {
    const r = await modifierOperationCommercial(op.id, patch);
    if (r.ok) onOperationModifiee?.({ ...op, ...patch });
  };
  const appliquerPerte = async (p) => {
    if (!p.ok) return p;
    await majChantier(p.journal.chantier_id, p.champs);
    const j = await journaliserStatut(p.journal);
    if (!j.ok) alert(`Le statut est enregistré, mais l'historique n'a pas pu être écrit : ${j.erreur}`);
    setPerte(null);
    return { ok: true };
  };
  const clientEnregistre = async (client) => {
    setClients((l) => [...l.filter((c) => c.id !== client.id), client]);
    const cible = ficheClient?.cible;
    setFicheClient(null);
    if (cible === "operation") await majOperation({ client_id: client.id });
    else if (cible) await majChantier(cible, { client_id: client.id });
  };

  // Lot 4 (demande de Loris du 06/11) : client ProGBat existant → fiche locale.
  const clientProgbatChoisi = async (client, rep) => {
    setClients((l) => [...l.filter((c) => c.id !== client.id), client]);
    const cible = choixProgbat?.cible;
    setChoixProgbat(null);
    setInfoProgbat({ texte: rep?.message || "Client ProGBat repris.", manquants: rep?.manquants || [] });   // les absences ProGBat : note grise sous le client
    if (cible === "operation") await majOperation({ client_id: client.id });
    else if (cible) await majChantier(cible, { client_id: client.id });
  };
  // Ce qui bloque le devis (liste unique des règles). Pour un client relié à
  // ProGBat, les règles Profero (prénom, e-mail, téléphone) ne s'appliquent
  // pas : ce que ProGBat n'a pas est une note grise (NoteClientProgbat).
  const manquantsFiche = (cl) => (cl ? controlerFiche("client", cl) : []);

  const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: .7, textTransform: "uppercase", color: textMuted, marginBottom: 4 };
  const caOp = op.charge_affaires_id ? { id: op.charge_affaires_id, nom: op.charge_affaires_nom } : null;

  return (
    <div style={{ background: T.surface, border: `1px solid ${border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: text, flex: 1 }}>Client, chargé d'affaires et statuts</div>
        <BadgeStatut operation statut={statutOp.statut} title={`Statut calculé : ${statutOp.raison}`} />
        <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>{statutOp.raison}</span>
      </div>
      {erreurClients && (
        <div style={{ color: "#e15a5a", fontSize: FONT.sm.size, marginBottom: 10 }}>Fiches client illisibles : {erreurClients}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={lbl}>Client de l'opération (par défaut pour ses chantiers)</div>
          <ChoixClient T={T} clients={clients} valeur={op.client_id || ""} disabled={!peutModifier}
            onChange={(id) => majOperation({ client_id: id })}
            onNouveau={peutModifier ? () => setFicheClient({ cible: "operation" }) : null}
            onProgbat={peutModifier ? () => setChoixProgbat({ cible: "operation" }) : null} />
          {clientOp && manquantsFiche(clientOp).length > 0 && (
            <div style={{ marginTop: 6 }}><ListeManquants T={T} manquants={manquantsFiche(clientOp)} titre="Fiche client incomplète (règles Profero, à compléter avant le devis) :" /></div>
          )}
          {clientOp && <NoteClientProgbat T={T} client={clientOp} onClient={remplacerClient} bouton={peutModifier} />}
          {clientOp && peutModifier && (
            <button onClick={() => setFicheClient({ cible: "operation", client: clientOp })} style={{ marginTop: 6, background: "transparent", border: "none", color: textSub, cursor: "pointer", fontSize: FONT.xs.size + 1, display: "inline-flex", alignItems: "center", gap: 4, padding: 0, fontFamily: "inherit" }}>
              <Icon as={Pencil} size={11} /> Modifier la fiche de {libelleClient(clientOp)}
            </button>
          )}
          {!op.client_id && <div style={{ fontSize: FONT.xs.size + 1, color: "#f5a623", marginTop: 4 }}>Aucun client : les chantiers sans client propre ne pourront pas être chiffrés jusqu'au devis.</div>}
        </div>
        <div>
          <div style={lbl}>Chargé d'affaires de l'opération (par défaut)</div>
          <ChoixChargeAffaires T={T} collaborateurs={collab.collaborateurs} complete={collab.complete} disabled={!peutModifier}
            valeur={op.charge_affaires_id || ""} nomEnregistre={op.charge_affaires_nom || ""}
            onChange={({ id, nom }) => majOperation({ charge_affaires_id: id, charge_affaires_nom: nom })} />
        </div>
      </div>

      {chantiersOp.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.sm.size, color: text }}>
            <thead>
              <tr style={{ textAlign: "left", color: textMuted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: .6 }}>
                <th style={{ padding: "6px 8px" }}>Chantier</th>
                <th style={{ padding: "6px 8px" }}>Statut</th>
                <th style={{ padding: "6px 8px", minWidth: 200 }}>Client</th>
                <th style={{ padding: "6px 8px", minWidth: 200 }}>Chargé d'affaires</th>
                <th style={{ padding: "6px 8px" }} />
              </tr>
            </thead>
            <tbody>
              {chantiersOp.map((c) => {
                const ce = clientEffectif(c, op);
                const ca = chargeAffairesEffectif(c, op);
                return (
                  <tr key={c.id} style={{ borderTop: `1px solid ${border}`, verticalAlign: "top" }}>
                    <td style={{ padding: "8px", fontWeight: 700 }}>
                      {c.nom}
                      {estChantierPerdu(c) && <ResumePerte chantier={c} T={T} />}
                    </td>
                    <td style={{ padding: "8px" }}><BadgeStatut statut={statutAffiche(c)} /></td>
                    <td style={{ padding: "8px" }}>
                      <ChoixClient T={T} clients={clients} valeur={c.client_id || ""} disabled={!peutModifier}
                        heritage={clientOp ? libelleClient(clientOp) : (op.client_id ? "client introuvable" : "aucun")}
                        onChange={(id) => majChantier(c.id, { client_id: id })}
                        onNouveau={peutModifier ? () => setFicheClient({ cible: c.id }) : null}
                        onProgbat={peutModifier ? () => setChoixProgbat({ cible: c.id }) : null} />
                      {c.client_id && clientParId.get(c.client_id) && manquantsFiche(clientParId.get(c.client_id)).length > 0 && (
                        <div style={{ fontSize: FONT.xs.size, color: "#f5a623", marginTop: 3 }}>Fiche incomplète : {manquantsFiche(clientParId.get(c.client_id)).map((m) => m.libelle).join(", ")}</div>
                      )}
                      {c.client_id && clientParId.get(c.client_id) && <NoteClientProgbat T={T} client={clientParId.get(c.client_id)} onClient={remplacerClient} bouton={false} />}
                      {!ce.valeur && <div style={{ fontSize: FONT.xs.size, color: "#f5a623", marginTop: 3 }}>Aucun client</div>}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <ChoixChargeAffaires T={T} collaborateurs={collab.collaborateurs} complete={collab.complete} disabled={!peutModifier}
                        valeur={c.charge_affaires_id || ""} nomEnregistre={c.charge_affaires_nom || ""}
                        heritage={caOp ? (caOp.nom || "compte introuvable") : "aucun"}
                        onChange={({ id, nom }) => majChantier(c.id, { charge_affaires_id: id, charge_affaires_nom: nom })} />
                      {!ca.id && <div style={{ fontSize: FONT.xs.size, color: "#f5a623", marginTop: 3 }}>Aucun chargé d'affaires</div>}
                    </td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      {peutModifier && peutMarquerPerdu(c).ok && (
                        <button onClick={() => setPerte({ mode: "perdu", chantier: c })} style={{ background: "transparent", border: "1px solid #94a3b880", color: "#94a3b8", borderRadius: RADIUS.pill, padding: "3px 10px", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Marquer perdu</button>
                      )}
                      {peutModifier && estChantierPerdu(c) && (
                        <button onClick={() => setPerte({ mode: "annuler", chantier: c })} style={{ background: "transparent", border: `1px solid ${border}`, color: textSub, borderRadius: RADIUS.pill, padding: "3px 10px", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Annuler « perdu »</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!peutModifier && (
        <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={UserCircle} size={12} /> Lecture seule sur cet écran.
        </div>
      )}

      {infoProgbat && (
        <div style={{ marginTop: 10, fontSize: FONT.xs.size + 1, color: infoProgbat.manquants.length ? "#f5a623" : "#22c55e", fontWeight: 700 }}>
          {infoProgbat.texte}
          <button onClick={() => setInfoProgbat(null)} style={{ marginLeft: 8, background: "transparent", border: "none", color: textMuted, cursor: "pointer", fontFamily: "inherit" }}>×</button>
        </div>
      )}
      {choixProgbat && (
        <ChoixClientProgbatModal T={T} onClose={() => setChoixProgbat(null)} onChoisi={clientProgbatChoisi} />
      )}
      {ficheClient && (
        <FicheClientModal T={T} client={ficheClient.client || null} onClose={() => setFicheClient(null)} onEnregistre={clientEnregistre} />
      )}
      {perte?.mode === "perdu" && (
        <MarquerPerduModal T={T} chantier={perte.chantier} onClose={() => setPerte(null)}
          onValider={({ motif, detail }) => appliquerPerte(preparerPerte(perte.chantier, { motif, detail, auteur, le: new Date().toISOString() }))} />
      )}
      {perte?.mode === "annuler" && (
        <AnnulerPerteModal T={T} chantier={perte.chantier} onClose={() => setPerte(null)}
          onValider={({ raison }) => appliquerPerte(preparerAnnulationPerte(perte.chantier, { raison, auteur }))} />
      )}
    </div>
  );
}
