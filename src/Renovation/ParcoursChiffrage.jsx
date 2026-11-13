// ─────────────────────────────────────────────────────────────────────────────
// Parcours de chiffrage imposé (Refonte Opérations, lot 2) :
//   1. choisir ou créer l'OPÉRATION ;
//   2. créer le CHANTIER (il naît « À l'étude ») : référence du logement,
//      adresse, chargé d'affaires ;
//   3. choisir ou créer le CLIENT (celui de l'opération par défaut) ;
//   4. chiffrer : le chiffrage est créé (ou rattaché) et ouvert.
// Impossible de chiffrer sans opération : il n'y a pas d'autre entrée pour
// créer un chiffrage. Mode « rattacher » : un chiffrage existant sans
// chantier suit le même parcours (ses adresses sont reprises).
//
// Ce composant crée l'opération et le chantier ; la page Chiffrage crée ou
// met à jour le chiffrage et pose le lien (onValider).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { X, Building2, HardHat, UserCircle, Check } from "lucide-react";
import { TYPES_LOGEMENT } from "./chiffragePricing.mjs";
import { controlerFiche, estObligatoire, clientDepuisProjet } from "./reglesSaisieProgbat.js";
import { STATUT_A_L_ETUDE } from "./statutsChantier.js";
import { chargerChantiers, creerOperation, modifierOperationCommercial, sauverChantiers } from "./chantiersDonnees.js";
import { libelleClient } from "./clientsDonnees.js";
import { Asterisque, ChoixClient, ChoixChargeAffaires, FicheClientModal, ListeManquants } from "./ComposantsCommerciaux.jsx";
import { ChoixClientProgbatModal } from "./ClientsProgbat.jsx";

const slug = (s) => String(s || "chantier").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);

export default function ParcoursChiffrage({
  T, operations = [], clients = [], collab = { collaborateurs: [], complete: true },
  projet = null, operationInitiale = null, setChantiers, onClientCree, onOperationsModifiees, onClose, onValider,
}) {
  const c = { surface: T.surface, border: T.border, text: T.text, textSub: T.textSub, textMuted: T.textMuted, card: T.card || "rgba(255,255,255,0.04)" };
  const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: c.textSub, marginBottom: 5, textTransform: "uppercase", letterSpacing: .5 };
  const inp = { width: "100%", padding: "9px 12px", background: c.card, border: `1px solid ${c.border}`, borderRadius: 7, color: c.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
  const btn = { background: "#FFC300", color: "#000", border: "none", borderRadius: 7, padding: "9px 18px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: "pointer" };
  const btnSec = { background: "transparent", color: c.textSub, border: `1px solid ${c.border}`, borderRadius: 7, padding: "8px 14px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" };

  const [etape, setEtape] = useState(1);
  const [choixProgbat, setChoixProgbat] = useState(false);   // lot 4 : client ProGBat existant
  // 1. Opération
  const [opId, setOpId] = useState(operationInitiale || "");
  const [nouvelleOp, setNouvelleOp] = useState(!operations.length);
  const [opNom, setOpNom] = useState("");
  const [opAdresse, setOpAdresse] = useState("");
  const op = nouvelleOp ? null : operations.find((o) => o.id === opId) || null;
  // 2. Chantier
  const [ch, setCh] = useState(() => ({
    reference_logement: projet?.logement_reference || "",
    type_logement: projet?.type_logement || "",
    nom: "",
    adresse: projet?.chantier_adresse || "",
    adresse_complement: projet?.chantier_adresse_complement || "",
    code_postal: projet?.chantier_code_postal || "",
    ville: projet?.chantier_ville || "",
  }));
  const [charge, setCharge] = useState({ id: null, nom: null });
  // 3. Client
  const [clientId, setClientId] = useState("");
  const [ficheOuverte, setFicheOuverte] = useState(false);
  const [manquants, setManquants] = useState([]);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState("");

  const majCh = (k, v) => setCh((x) => ({ ...x, [k]: v }));
  const nomOperation = nouvelleOp ? opNom.trim() : (op?.nom || "");
  const nomChantier = ch.nom.trim() || [nomOperation, ch.reference_logement.trim()].filter(Boolean).join(" — ");
  const chargeEffectif = charge.id ? charge : (op?.charge_affaires_id ? { id: op.charge_affaires_id, nom: op.charge_affaires_nom } : { id: null, nom: null });
  const clientEffectifId = clientId || op?.client_id || "";
  const clientChoisi = clients.find((x) => x.id === clientEffectifId) || null;

  const controleEtape = (n) => {
    if (n === 1) return (nouvelleOp ? !opNom.trim() : !op) ? [{ libelle: "Choisir une opération ou en créer une (nom obligatoire)" }] : [];
    if (n === 2) return controlerFiche("chantier", { ...ch, chantier_id: "nouveau", charge_affaires_id: chargeEffectif.id || "" });
    if (n === 3) {
      if (!clientChoisi) return [{ libelle: "Choisir ou créer le client" }];
      return controlerFiche("client", clientChoisi);
    }
    return [];
  };
  const suivant = () => {
    const m = controleEtape(etape);
    setManquants(m);
    if (!m.length) setEtape(etape + 1);
  };

  const valider = async () => {
    const m = [1, 2, 3].flatMap(controleEtape);
    setManquants(m);
    if (m.length || busy) return;
    setBusy(true); setErreur("");
    try {
      // ── 1. Opération : créée, ou complétée si elle n'avait ni client ni chargé d'affaires
      let operation = op;
      if (nouvelleOp) {
        const r = await creerOperation({
          id: `op_${Date.now()}`, nom: opNom.trim(), adresse: opAdresse.trim(), couleur: "#888888",
          client_id: clientChoisi.id, charge_affaires_id: chargeEffectif.id, charge_affaires_nom: chargeEffectif.nom,
        });
        if (!r.ok) throw new Error(`Création de l'opération impossible : ${r.erreur}`);
        operation = r.operation;
      } else {
        const patch = {};
        if (!op.client_id) patch.client_id = clientChoisi.id;
        if (!op.charge_affaires_id && chargeEffectif.id) { patch.charge_affaires_id = chargeEffectif.id; patch.charge_affaires_nom = chargeEffectif.nom; }
        if (Object.keys(patch).length) {
          const r = await modifierOperationCommercial(op.id, patch);
          if (!r.ok) throw new Error(`Mise à jour de l'opération impossible : ${r.erreur}`);
          operation = { ...op, ...patch };
        }
      }
      onOperationsModifiees?.(operation);
      // ── 2. Chantier « À l'étude » ; client / chargé propres seulement s'ils diffèrent de l'opération
      const chantierId = `${slug(nomChantier)}-${Date.now()}`;
      const nouveau = {
        id: chantierId, nom: nomChantier, couleur: operation.couleur || "#888888",
        statut: STATUT_A_L_ETUDE, operation_id: operation.id,
        ...(operation.client_id && operation.client_id !== clientChoisi.id ? { client_id: clientChoisi.id } : {}),
        ...(chargeEffectif.id && operation.charge_affaires_id !== chargeEffectif.id ? { charge_affaires_id: chargeEffectif.id, charge_affaires_nom: chargeEffectif.nom } : {}),
      };
      const r2 = await sauverChantiers([nouveau]);
      if (r2?.erreurs?.length) throw new Error(`Création du chantier impossible : ${r2.erreurs.join(" ; ")}`);
      if (setChantiers) setChantiers(await chargerChantiers());
      // ── 3. Chiffrage (créé ou rattaché par la page)
      const r3 = await onValider({ operation, chantierId, client: clientChoisi, chantier: { ...ch, nom: nomChantier } });
      if (r3 && r3.ok === false) throw new Error(r3.erreur || "Chiffrage non créé");
    } catch (e) {
      setErreur(e?.message || String(e));
    }
    setBusy(false);
  };

  const champ = (label, k, fiche, props = {}) => (
    <div style={props.span ? { gridColumn: "1 / -1" } : undefined}>
      <label style={lbl}>{label}{fiche && estObligatoire(fiche[0], fiche[1], {}) && <Asterisque />}</label>
      <input style={inp} value={ch[k] ?? ""} placeholder={props.placeholder || ""} onChange={(e) => majCh(k, e.target.value)} />
    </div>
  );

  const etapes = [[1, "Opération", Building2], [2, "Chantier", HardHat], [3, "Client", UserCircle]];
  const opsTriees = useMemo(() => [...operations].sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr")), [operations]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: RADIUS.xl, width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ flex: 1, fontSize: FONT.lg.size, fontWeight: 800, color: c.text }}>{projet ? "Rattacher ce chiffrage à un chantier" : "Nouveau chiffrage"}</div>
          <button onClick={onClose} style={{ ...btnSec, padding: 6, display: "inline-flex" }} title="Fermer"><Icon as={X} size={14} /></button>
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: c.textMuted, marginBottom: 14 }}>
          Opération → chantier (il naît « À l'étude ») → client → chiffrage. Impossible de chiffrer sans opération.
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {etapes.map(([n, label, Ic]) => (
            <div key={n} style={{ flex: 1, padding: "7px 10px", borderRadius: RADIUS.md, fontSize: FONT.sm.size, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
              background: etape === n ? "#FFC30022" : "transparent", border: `1px solid ${etape === n ? "#FFC300" : c.border}`, color: etape >= n ? c.text : c.textMuted }}>
              <Icon as={etape > n ? Check : Ic} size={13} /> {n}. {label}
            </div>
          ))}
        </div>

        {etape === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setNouvelleOp(false)} disabled={!operations.length} style={{ ...btnSec, flex: 1, fontWeight: 700, ...(!nouvelleOp ? { background: "#FFC300", color: "#000" } : {}) }}>Opération existante</button>
              <button type="button" onClick={() => setNouvelleOp(true)} style={{ ...btnSec, flex: 1, fontWeight: 700, ...(nouvelleOp ? { background: "#FFC300", color: "#000" } : {}) }}>Nouvelle opération</button>
            </div>
            {nouvelleOp ? (
              <>
                <div><label style={lbl}>Nom de l'opération<Asterisque /></label><input style={inp} value={opNom} onChange={(e) => setOpNom(e.target.value)} placeholder="Ex : Immeuble rue Pasteur" /></div>
                <div><label style={lbl}>Adresse de l'opération</label><input style={inp} value={opAdresse} onChange={(e) => setOpAdresse(e.target.value)} placeholder="36 rue Pasteur, Segré" /></div>
              </>
            ) : (
              <div>
                <label style={lbl}>Opération<Asterisque /></label>
                <select style={{ ...inp, cursor: "pointer" }} value={opId} onChange={(e) => setOpId(e.target.value)}>
                  <option value="">— Choisir l'opération —</option>
                  {opsTriees.map((o) => <option key={o.id} value={o.id}>{o.nom}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {etape === 2 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {champ("Référence du logement", "reference_logement", ["chantier", "reference_logement"], { placeholder: "T2 - R+2" })}
            <div>
              <label style={lbl}>Type de logement</label>
              <select style={{ ...inp, cursor: "pointer" }} value={ch.type_logement} onChange={(e) => majCh("type_logement", e.target.value)}>
                <option value="">— Choisir —</option>
                {TYPES_LOGEMENT.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>Nom du chantier dans l'application</label>
              <input style={inp} value={ch.nom} onChange={(e) => majCh("nom", e.target.value)} placeholder={nomChantier || "Opération — référence"} />
            </div>
            {champ("Adresse du chantier", "adresse", ["chantier", "adresse"], { span: true, placeholder: "12 rue des Lilas" })}
            {champ("Complément", "adresse_complement", null, { placeholder: "Escalier A" })}
            {champ("Code postal", "code_postal", ["chantier", "code_postal"], { placeholder: "49000" })}
            {champ("Ville", "ville", ["chantier", "ville"], { placeholder: "Angers" })}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>Chargé d'affaires<Asterisque /></label>
              <ChoixChargeAffaires T={T} collaborateurs={collab.collaborateurs} complete={collab.complete}
                valeur={charge.id || ""} nomEnregistre={charge.nom || ""}
                heritage={op?.charge_affaires_id ? (op.charge_affaires_nom || "compte introuvable") : null}
                onChange={setCharge} />
            </div>
          </div>
        )}

        {etape === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Client<Asterisque /></label>
            <ChoixClient T={T} clients={clients} valeur={clientId}
              heritage={op?.client_id ? (libelleClient(clients.find((x) => x.id === op.client_id)) || "client introuvable") : null}
              onChange={(id) => setClientId(id || "")} onNouveau={() => setFicheOuverte(true)}
              onProgbat={() => setChoixProgbat(true)} />
            {choixProgbat && (
              <ChoixClientProgbatModal T={T} onClose={() => setChoixProgbat(false)}
                onChoisi={(client) => { setChoixProgbat(false); onClientCree?.(client); setClientId(client.id); }} />
            )}
            {clientChoisi && (
              <div style={{ fontSize: FONT.sm.size, color: c.textSub, lineHeight: 1.5 }}>
                {libelleClient(clientChoisi)} — {[clientChoisi.adresse, clientChoisi.code_postal, clientChoisi.ville].filter(Boolean).join(" ")} — {clientChoisi.email} — {clientChoisi.telephone}
                <br />{clientChoisi.progbat_client_id ? <>Client ProGBat n° {clientChoisi.progbat_client_id} : <strong style={{ color: c.text }}>{clientChoisi.code_progbat || "—"}</strong></> : <>Identifiant ProGBat généré : <strong style={{ color: c.text }}>{clientChoisi.code_progbat || "—"}</strong></>}
              </div>
            )}
            {projet && (
              <div style={{ fontSize: FONT.xs.size + 1, color: c.textMuted }}>
                Les coordonnées du client de ce chiffrage seront remplacées par celles de la fiche choisie (« Créer » pré-remplit la fiche avec celles du chiffrage).
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <ListeManquants T={T} manquants={manquants} titre="Pour continuer, il manque :" />
          {erreur && <div style={{ color: "#e15a5a", fontSize: FONT.sm.size }}>{erreur}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <button onClick={() => (etape > 1 ? (setManquants([]), setEtape(etape - 1)) : onClose())} style={btnSec}>{etape > 1 ? "Précédent" : "Annuler"}</button>
            {etape < 3
              ? <button onClick={suivant} style={btn}>Suivant</button>
              : <button onClick={valider} disabled={busy} style={{ ...btn, opacity: busy ? .6 : 1 }}>{busy ? "Création…" : projet ? "Rattacher et continuer" : "Créer et chiffrer"}</button>}
          </div>
        </div>
      </div>
      {ficheOuverte && (
        <div onClick={(e) => e.stopPropagation()}>
          <FicheClientModal T={T} initial={projet ? projetVersFicheClient(projet) : null} onClose={() => setFicheOuverte(false)}
            onEnregistre={(client) => { setFicheOuverte(false); onClientCree?.(client); setClientId(client.id); }} />
        </div>
      )}
    </div>
  );
}

/** Pré-remplissage d'une fiche client depuis un ancien chiffrage (choix explicite). */
function projetVersFicheClient(p) {
  const f = clientDepuisProjet(p);
  return { ...f, adresse_complement: p.client_adresse_complement || "", pays: f.pays || "France" };
}
