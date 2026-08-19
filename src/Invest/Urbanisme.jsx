import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { THEMES_INV, SU, WA, DA, IN, KPICard, CompletionBar } from "./_shared";
import {
  FileText, Plus, Trash2, ArrowLeft, RefreshCw, Search, AlertTriangle, Check,
  CalendarClock, ClipboardList, ListChecks, Printer, Send, Building2, Landmark,
  Home, Ruler, Car, Camera, ChevronRight, ChevronDown, Info, Link as LinkIcon,
  MapPin, ShieldAlert, UserCheck, Clock, Layers,
} from "lucide-react";
import {
  URBA_ENTITES, URBA_ORIGINES_CONTRAINTE, URBA_STATUTS, URBA_STATUTS_AVANT_DEPOT,
  URBA_AUTORISATIONS, URBA_NATURES, URBA_GRILLE, URBA_PIECES, URBA_PIECE_STATUTS,
  URBA_CADRAGE_PHOTOS, URBA_NOMMAGE_FICHIERS, URBA_DELAIS, URBA_REGLE_COMMERCIALE,
  URBA_TODO, URBA_OUBLIS,
  urbaStatut, urbaPieceStatut, urbaDossierVide, urbaLigneFacadeVide, urbaLogementVide,
  urbaBatimentVide, urbaCompletude, urbaExigences, urbaGrilleActive, urbaRetroplanning,
  urbaArchitecte, urbaLignesFacade, urbaLigneFacadeManques, urbaTotal, urbaFmtDate,
  urbaJoursRestants, urbaISO, urbaColonnes, urbaDivisionConcernee, urbaFacadeConcernee,
  urbaSurfacesConcernees, urbaStationnementConcerne, urbaSocieteExistante, urbaEstABF,
  urbaSurfacePlancherTotale, urbaDelaiInstruction, urbaDelaiPreparation,
  listerDossiers, chargerDossier, creerDossier, majDossier, supprimerDossier,
} from "./urbanismeStore";
import { imprimerFDU } from "./urbanismeImpression";

// ─────────────────────────────────────────────────────────────────────────────
// URBANISME — suivi des dossiers et Fiche de Demande Urbanisme (FDU)
//
// Deux écrans :
//   • la liste — le suivi des dossiers : où en est chaque demande, ce qui doit
//     partir cette semaine, ce qui est en retard sur sa date maximum de dépôt ;
//   • la fiche — la FDU elle-même, en cinq onglets qui suivent le document
//     papier (Demande, Projet, Pièces, Rétroplanning, Process).
//
// La règle d'or « une FDU incomplète n'est pas prise en charge et repart au
// commercial » n'est pas une consigne écrite quelque part : le bouton
// « Transmettre » est fermé tant que `urbaCompletude().transmissible` est faux,
// et l'écran dit lequel des champs ou des pièces manque.
// ─────────────────────────────────────────────────────────────────────────────

const T_DEFAUT = THEMES_INV.dark;
const txt = (v) => String(v ?? "").trim();
const LEVELS = { danger:DA, warning:WA, success:SU, info:IN };

/* ============ Champs de saisie ============ */

// Un champ manquant se voit : bordure rouge et astérisque. La liste
// exhaustive de ce qui manque reste dans l'onglet Process, mais on ne veut pas
// obliger à y aller pour savoir quoi remplir sous ses yeux.
function Champ({ label, aide, requis, manque, children, T = T_DEFAUT, span }) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0, gridColumn:span ? "1 / -1" : undefined }}>
      <span style={{ fontSize:FONT.xs.size + 1, fontWeight:700, color:manque ? DA : T.textSub, letterSpacing:.2 }}>
        {label}{requis && <span style={{ color:manque ? DA : T.textMuted }}> *</span>}
      </span>
      {children}
      {aide && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, fontStyle:"italic" }}>{aide}</span>}
    </label>
  );
}

const styleSaisie = (manque, T) => ({
  width:"100%", textAlign:"left",
  borderColor: manque ? DA : undefined,
});

function Txt({ label, value, onChange, placeholder, requis, aide, T = T_DEFAUT, span, type = "text" }) {
  const manque = requis && !txt(value);
  return (
    <Champ label={label} aide={aide} requis={requis} manque={manque} T={T} span={span}>
      <input className="inv-inp" type={type} value={value || ""} placeholder={placeholder || ""}
        onChange={e => onChange(e.target.value)} style={styleSaisie(manque, T)}/>
    </Champ>
  );
}

function Dte({ label, value, onChange, requis, aide, T = T_DEFAUT, span }) {
  const manque = requis && !txt(value);
  return (
    <Champ label={label} aide={aide} requis={requis} manque={manque} T={T} span={span}>
      <input className="inv-inp" type="date" value={value || ""}
        onChange={e => onChange(e.target.value)} style={{ width:"100%", borderColor:manque ? DA : undefined }}/>
    </Champ>
  );
}

function Sel({ label, value, onChange, options, requis, aide, vide = "—", T = T_DEFAUT, span }) {
  const manque = requis && !txt(value);
  return (
    <Champ label={label} aide={aide} requis={requis} manque={manque} T={T} span={span}>
      <select className="inv-sel" value={value || ""} onChange={e => onChange(e.target.value)}
        style={{ width:"100%", borderColor:manque ? DA : undefined }}>
        <option value="">{vide}</option>
        {options.map(o => {
          const v = typeof o === "string" ? o : o.value;
          const l = typeof o === "string" ? o : o.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </Champ>
  );
}

function Area({ label, value, onChange, placeholder, requis, aide, rows = 4, T = T_DEFAUT }) {
  const manque = requis && !txt(value);
  return (
    <Champ label={label} aide={aide} requis={requis} manque={manque} T={T} span>
      <textarea className="inv-inp" value={value || ""} placeholder={placeholder || ""}
        onChange={e => onChange(e.target.value)}
        style={{ width:"100%", textAlign:"left", minHeight:rows * 22, borderColor:manque ? DA : undefined }}/>
    </Champ>
  );
}

function Chk({ label, checked, onChange, T = T_DEFAUT, color }) {
  return (
    <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:FONT.sm.size + 1,
      color:checked ? (color || T.text) : T.textSub, cursor:"pointer", fontWeight:checked ? 700 : 500, lineHeight:1.35 }}>
      <input type="checkbox" checked={Boolean(checked)} onChange={e => onChange(e.target.checked)}
        style={{ marginTop:2, accentColor:color || T.accent, flexShrink:0 }}/>
      <span>{label}</span>
    </label>
  );
}

const GRILLE_CHAMPS = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:SPACING.md };

function Carte({ titre, icone, ton = "", children, action, T = T_DEFAUT, sous }) {
  return (
    <div className="inv-card" style={{ marginBottom:SPACING.lg }}>
      <div className={"inv-card-hd " + ton} style={{ alignItems:"center" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:7 }}>
          {icone && <Icon as={icone} size={13} strokeWidth={2.2}/>}{titre}
        </span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:10 }}>
          {sous && <span style={{ fontSize:FONT.xs.size, color:T.textMuted, textTransform:"none", letterSpacing:0, fontWeight:600 }}>{sous}</span>}
          {action}
        </span>
      </div>
      <div className="inv-card-bd">{children}</div>
    </div>
  );
}

function Bandeau({ level = "info", children, T = T_DEFAUT }) {
  const c = LEVELS[level] || IN;
  return (
    <div style={{ display:"flex", gap:9, alignItems:"flex-start", border:`1px solid ${c}55`,
      background:`${c}14`, borderRadius:RADIUS.md, padding:`${SPACING.sm + 1}px ${SPACING.md}px`,
      fontSize:FONT.sm.size + 1, color:T.text, lineHeight:1.4 }}>
      <Icon as={level === "success" ? Check : level === "info" ? Info : AlertTriangle} size={15} style={{ color:c, flexShrink:0, marginTop:1 }}/>
      <span>{children}</span>
    </div>
  );
}

function Etiquette({ children, color, T = T_DEFAUT }) {
  const c = color || T.textMuted;
  return (
    <span style={{ display:"inline-block", padding:"2px 7px", borderRadius:RADIUS.pill,
      border:`1px solid ${c}55`, background:`${c}18`, color:c,
      fontSize:FONT.xs.size, fontWeight:800, whiteSpace:"nowrap" }}>{children}</span>
  );
}

const BadgeStatut = ({ statut, T }) => {
  const s = urbaStatut(statut);
  return <Etiquette color={s.color} T={T}>{s.label}</Etiquette>;
};

/* ============ Écran 1 — le suivi des dossiers ============ */

const NOUVEAU_VIDE = () => ({
  reference:"", entite:"Profero Invest", commercial:"", adresse:"", commune:"",
  date_max_depot:"",
});

function ListeUrbanisme({ profil, T = T_DEFAUT, onOuvrir }) {
  const [rows, setRows] = useState(null);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState(null);
  const [creation, setCreation] = useState(false);
  const [q, setQ] = useState("");
  const [fStatut, setFStatut] = useState("actifs");
  const [fEntite, setFEntite] = useState("");
  const [fCommercial, setFCommercial] = useState("");
  const [fAbf, setFAbf] = useState(false);
  const [memo, setMemo] = useState(false);

  const recharger = useCallback(() => {
    listerDossiers()
      .then(r => { setRows(r); setErreur(""); })
      .catch(e => {
        setRows([]);
        setErreur(
          /relation .* does not exist|schema cache/i.test(e.message || "")
            ? "La table invest_urbanisme_dossiers n'existe pas encore : exécutez sql/202608_invest_urbanisme.sql dans l'éditeur SQL Supabase."
            : "Chargement impossible : " + (e.message || e)
        );
      });
  }, []);

  useEffect(() => { recharger(); }, [recharger]);

  const commerciaux = useMemo(
    () => Array.from(new Set((rows || []).map(r => txt(r.commercial)).filter(Boolean))).sort(),
    [rows]);

  // Une demande « en retard » est une demande dont la date maximum de dépôt est
  // passée sans dépôt : c'est la seule alerte qui coûte un litige.
  const enrichi = useMemo(() => (rows || []).map(r => {
    const avantDepot = URBA_STATUTS_AVANT_DEPOT.includes(r.statut);
    const reste = avantDepot ? urbaJoursRestants(r.date_max_depot) : null;
    return {
      ...r,
      avantDepot,
      reste,
      retard: avantDepot && reste !== null && reste < 0,
      urgent: avantDepot && reste !== null && reste >= 0 && reste <= 15,
      instruction: r.statut === "depose" || r.statut === "pieces_mairie",
    };
  }), [rows]);

  const stats = useMemo(() => ({
    commercial: enrichi.filter(r => r.statut === "brouillon" || r.statut === "attente_pieces").length,
    verif: enrichi.filter(r => r.statut === "transmis").length,
    pret: enrichi.filter(r => r.statut === "complet").length,
    instruction: enrichi.filter(r => r.instruction).length,
    urgent: enrichi.filter(r => r.urgent).length,
    retard: enrichi.filter(r => r.retard).length,
  }), [enrichi]);

  const liste = useMemo(() => {
    const needle = txt(q).toLowerCase();
    return enrichi.filter(r => {
      if (fStatut === "actifs" && ["purge", "refuse", "abandonne"].includes(r.statut)) return false;
      if (fStatut === "retard" && !r.retard) return false;
      if (fStatut === "commercial" && !["brouillon", "attente_pieces"].includes(r.statut)) return false;
      if (fStatut === "instruction" && !r.instruction) return false;
      if (fStatut && !["actifs", "retard", "commercial", "instruction"].includes(fStatut) && r.statut !== fStatut) return false;
      if (fEntite && r.entite !== fEntite) return false;
      if (fCommercial && txt(r.commercial) !== fCommercial) return false;
      if (fAbf && r.abf !== "Oui") return false;
      if (!needle) return true;
      return [r.reference, r.adresse, r.commune, r.commercial, r.code_postal]
        .some(v => txt(v).toLowerCase().includes(needle));
    }).sort((a, b) => {
      // Ce qui brûle d'abord : retard, puis échéance la plus proche, puis reste.
      if (a.retard !== b.retard) return a.retard ? -1 : 1;
      const ra = a.reste === null ? 99999 : a.reste;
      const rb = b.reste === null ? 99999 : b.reste;
      if (ra !== rb) return ra - rb;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
  }, [enrichi, q, fStatut, fEntite, fCommercial, fAbf]);

  const creer = async () => {
    if (!txt(form.reference)) return;
    setCreation(true);
    try {
      const donnees = urbaDossierVide({
        reference: txt(form.reference),
        entite: form.entite,
        commercial: txt(form.commercial) || profil?.nom || profil?.prenom || "",
        adresse: txt(form.adresse),
        commune: txt(form.commune),
        date_demande: urbaISO(new Date()),
        date_max_depot: form.date_max_depot || "",
      });
      const row = await creerDossier({
        ...urbaColonnes(donnees, "brouillon"),
        statut:"brouillon",
        auteur: profil?.nom || profil?.email || null,
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
    if (!window.confirm(`Supprimer la FDU « ${row.reference} » ?\n\nCette action est irréversible.`)) return;
    try { await supprimerDossier(row.id); recharger(); }
    catch (err) { setErreur("Suppression impossible : " + (err.message || err)); }
  };

  const cellule = { padding:"9px 8px", borderBottom:`1px solid ${T.rowBorder || T.border}`, fontSize:FONT.sm.size + 1, color:T.textSub, verticalAlign:"middle" };
  const entete = { padding:"8px", borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size, textTransform:"uppercase",
    letterSpacing:1, color:T.textMuted, textAlign:"left", whiteSpace:"nowrap", fontWeight:800 };

  return (
    <div style={{ padding:"24px 28px", maxWidth:1500, margin:"0 auto" }}>
      <div style={{ marginBottom:SPACING.xl }}>
        <div style={{ fontSize:FONT.h2.size, fontWeight:800, color:T.text, letterSpacing:.4 }}>Urbanisme — suivi des dossiers</div>
        <div style={{ fontSize:FONT.base.size, color:T.textSub, marginTop:5 }}>
          Une ligne = une demande d'autorisation. Une FDU incomplète n'est pas prise en charge et repart au commercial.
        </div>
      </div>

      {erreur && <div style={{ marginBottom:SPACING.lg }}><Bandeau level="danger" T={T}>{erreur}</Bandeau></div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:SPACING.md, marginBottom:SPACING.lg }}>
        <KPICard label="Chez le commercial" value={stats.commercial} icon={ClipboardList} color={stats.commercial ? WA : SU} sub="Brouillons + retours pour pièces" onClick={() => setFStatut("commercial")}/>
        <KPICard label="À vérifier" value={stats.verif} icon={UserCheck} color={IN} sub="Transmises au pôle urbanisme" onClick={() => setFStatut("transmis")}/>
        <KPICard label="Prêtes à déposer" value={stats.pret} icon={Check} color={SU} sub="Complètes, en attente de dépôt" onClick={() => setFStatut("complet")}/>
        <KPICard label="En instruction" value={stats.instruction} icon={Landmark} color={IN} sub="Déposées en mairie" onClick={() => setFStatut("instruction")}/>
        <KPICard label="Dépôt sous 15 j" value={stats.urgent} icon={CalendarClock} color={stats.urgent ? WA : SU} sub="Échéance proche"/>
        <KPICard label="Dépôt en retard" value={stats.retard} icon={AlertTriangle} color={stats.retard ? DA : SU} sub="Date maximum dépassée" onClick={() => setFStatut("retard")}/>
      </div>

      <Carte titre="Dossiers urbanisme" icone={FileText} ton="blue" T={T}
        sous={rows ? `${liste.length} dossier(s) affiché(s) sur ${rows.length}` : "Chargement…"}
        action={
          <span style={{ display:"inline-flex", gap:7 }}>
            <button className="inv-btn inv-btn-sm inv-btn-out" onClick={recharger}><Icon as={RefreshCw} size={12}/>Actualiser</button>
            <button className="inv-btn inv-btn-sm inv-btn-accent" onClick={() => setForm(form ? null : NOUVEAU_VIDE())}>
              <Icon as={Plus} size={12}/>{form ? "Annuler" : "Nouvelle FDU"}
            </button>
          </span>
        }>

        {form && (
          <div style={{ border:`1px solid ${T.accentBorder}`, background:T.input, borderRadius:RADIUS.lg,
            padding:SPACING.md, marginBottom:SPACING.lg }}>
            <div style={GRILLE_CHAMPS}>
              <Txt label="N° de dossier / réf. chantier" value={form.reference} requis T={T}
                onChange={v => setForm(f => ({ ...f, reference:v }))} placeholder="URB-2026-014"/>
              <Sel label="Entité concernée" value={form.entite} options={URBA_ENTITES} requis T={T}
                onChange={v => setForm(f => ({ ...f, entite:v }))}/>
              <Txt label="Commercial demandeur" value={form.commercial} T={T}
                onChange={v => setForm(f => ({ ...f, commercial:v }))} placeholder={profil?.nom || "Nom du commercial"}/>
              <Txt label="Adresse du bien" value={form.adresse} T={T}
                onChange={v => setForm(f => ({ ...f, adresse:v }))} placeholder="12 rue des Lilas"/>
              <Txt label="Commune" value={form.commune} T={T}
                onChange={v => setForm(f => ({ ...f, commune:v }))}/>
              <Dte label="Date maximum de dépôt" value={form.date_max_depot} T={T}
                onChange={v => setForm(f => ({ ...f, date_max_depot:v }))}
                aide="Se complète ensuite avec l'origine de la contrainte"/>
            </div>
            <div style={{ marginTop:SPACING.md }}>
              <button className="inv-btn inv-btn-accent" disabled={!txt(form.reference) || creation} onClick={creer}>
                <Icon as={Check} size={14}/>{creation ? "Création…" : "Créer la FDU et commencer la saisie"}
              </button>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:SPACING.sm, flexWrap:"wrap", alignItems:"center", marginBottom:SPACING.md }}>
          <span style={{ position:"relative", display:"inline-flex", alignItems:"center" }}>
            <Icon as={Search} size={13} style={{ position:"absolute", left:9, color:T.textMuted }}/>
            <input className="inv-inp" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Référence, adresse, commune, commercial…"
              style={{ width:280, textAlign:"left", paddingLeft:26 }}/>
          </span>
          <select className="inv-sel" value={fStatut} onChange={e => setFStatut(e.target.value)}>
            <option value="actifs">Dossiers actifs</option>
            <option value="">Tous les statuts</option>
            <option value="commercial">Chez le commercial</option>
            <option value="instruction">En instruction</option>
            <option value="retard">Dépôt en retard</option>
            {URBA_STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select className="inv-sel" value={fEntite} onChange={e => setFEntite(e.target.value)}>
            <option value="">Toutes les entités</option>
            {URBA_ENTITES.map(e => <option key={e}>{e}</option>)}
          </select>
          <select className="inv-sel" value={fCommercial} onChange={e => setFCommercial(e.target.value)}>
            <option value="">Tous les commerciaux</option>
            {commerciaux.map(c => <option key={c}>{c}</option>)}
          </select>
          <span style={{ display:"inline-flex", alignItems:"center" }}>
            <Chk label="Secteur ABF uniquement" checked={fAbf} onChange={setFAbf} T={T} color={WA}/>
          </span>
        </div>

        {!rows ? (
          <div style={{ padding:SPACING.xl, textAlign:"center", color:T.textMuted, fontStyle:"italic" }}>Chargement des dossiers…</div>
        ) : liste.length === 0 ? (
          <div style={{ padding:SPACING.xl, textAlign:"center", color:T.textMuted, fontStyle:"italic",
            border:`1px dashed ${T.border}`, borderRadius:RADIUS.md }}>
            {rows.length ? "Aucun dossier ne correspond aux filtres." : "Aucune FDU pour l'instant : cliquez sur « Nouvelle FDU »."}
          </div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1080 }}>
              <thead><tr>
                <th style={entete}>Dossier</th>
                <th style={entete}>Entité / commercial</th>
                <th style={entete}>Nature</th>
                <th style={entete}>Régime</th>
                <th style={{ ...entete, textAlign:"center" }}>ABF</th>
                <th style={{ ...entete, width:130 }}>Complétude</th>
                <th style={entete}>Pièces</th>
                <th style={entete}>Dépôt au plus tard</th>
                <th style={entete}>Fin d'instruction</th>
                <th style={entete}>Statut</th>
                <th style={entete}/>
              </tr></thead>
              <tbody>
                {liste.map(r => {
                  const natures = (r.natures || []).map(n => URBA_NATURES.find(x => x.id === n)?.label || n);
                  const couleurEcheance = r.retard ? DA : r.urgent ? WA : T.textSub;
                  return (
                    <tr key={r.id} style={{ cursor:"pointer" }} onClick={() => onOuvrir(r)}
                      onMouseEnter={e => { e.currentTarget.style.background = T.cardHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                      <td style={cellule}>
                        <div style={{ fontWeight:800, color:T.text }}>{r.reference}</div>
                        <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>
                          {[r.adresse, r.code_postal, r.commune].filter(Boolean).join(", ") || "Adresse non renseignée"}
                        </div>
                      </td>
                      <td style={cellule}>
                        <div>{r.entite}</div>
                        <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>{r.commercial || "—"}</div>
                      </td>
                      <td style={{ ...cellule, maxWidth:230 }}>
                        {natures.length ? (
                          <span style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                            {natures.slice(0, 2).map(n => <Etiquette key={n} color={T.accent} T={T}>{n}</Etiquette>)}
                            {natures.length > 2 && <Etiquette color={T.textMuted} T={T}>+{natures.length - 2}</Etiquette>}
                          </span>
                        ) : <span style={{ color:DA, fontStyle:"italic" }}>à préciser</span>}
                      </td>
                      <td style={cellule}>{r.autorisation || "—"}</td>
                      <td style={{ ...cellule, textAlign:"center" }}>
                        {r.abf === "Oui" ? <Etiquette color={WA} T={T}>ABF</Etiquette>
                          : r.abf === "Non" ? <span style={{ color:T.textMuted }}>Non</span>
                          : <Etiquette color={DA} T={T}>à vérifier</Etiquette>}
                      </td>
                      <td style={cellule}>
                        <CompletionBar label="" value={r.completude}
                          color={r.completude >= 100 ? SU : r.completude >= 60 ? WA : DA} T={T}/>
                      </td>
                      <td style={cellule}>
                        {r.nb_pieces_manquantes > 0
                          ? <Etiquette color={DA} T={T}>{r.nb_pieces_manquantes} manquante(s)</Etiquette>
                          : <Etiquette color={SU} T={T}>complètes</Etiquette>}
                      </td>
                      <td style={{ ...cellule, fontFamily:"'DM Mono',monospace", color:couleurEcheance, whiteSpace:"nowrap" }}>
                        {urbaFmtDate(r.date_max_depot)}
                        {r.avantDepot && r.reste !== null && (
                          <div style={{ fontSize:FONT.xs.size, color:couleurEcheance }}>
                            {r.reste < 0 ? `${Math.abs(r.reste)} j de retard` : `dans ${r.reste} j`}
                          </div>
                        )}
                        {r.date_depot && <div style={{ fontSize:FONT.xs.size, color:SU }}>déposé le {urbaFmtDate(r.date_depot)}</div>}
                      </td>
                      <td style={{ ...cellule, fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap" }}>{urbaFmtDate(r.date_fin_instruction)}</td>
                      <td style={cellule}><BadgeStatut statut={r.statut} T={T}/></td>
                      <td style={{ ...cellule, textAlign:"right" }}>
                        <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={e => supprimer(r, e)}>
                          <Icon as={Trash2} size={11}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Carte>

      <Carte titre="Mémo commercial — les délais à connaître" icone={CalendarClock} ton="gold" T={T}
        sous={memo ? "" : "À ouvrir avant de promettre une date"}
        action={<button className="inv-btn inv-btn-sm inv-btn-out" onClick={() => setMemo(m => !m)}>
          <Icon as={memo ? ChevronDown : ChevronRight} size={12}/>{memo ? "Replier" : "Déplier"}
        </button>}>
        {!memo ? (
          <Bandeau level="warning" T={T}>{URBA_REGLE_COMMERCIALE}</Bandeau>
        ) : (
          <>
            <TableauDelais T={T}/>
            <div style={{ marginTop:SPACING.md }}><Bandeau level="warning" T={T}>{URBA_REGLE_COMMERCIALE}</Bandeau></div>
            <div style={{ marginTop:SPACING.lg }}>
              <div style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.text, marginBottom:SPACING.sm }}>
                Les 6 oublis qui génèrent les relances
              </div>
              <ol style={{ margin:0, paddingLeft:20, color:T.textSub, fontSize:FONT.sm.size + 1, lineHeight:1.7 }}>
                {URBA_OUBLIS.map(o => <li key={o.id}>{o.label}{o.rang && <span style={{ color:DA, fontWeight:800 }}> — {o.rang}</span>}</li>)}
              </ol>
            </div>
          </>
        )}
      </Carte>
    </div>
  );
}

// Tableau de référence des délais, tel qu'il se lit devant un client.
function TableauDelais({ T = T_DEFAUT, surligne }) {
  const th = { padding:"7px 8px", borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size,
    textTransform:"uppercase", letterSpacing:1, color:T.textMuted, textAlign:"left", fontWeight:800 };
  const td = { padding:"7px 8px", borderBottom:`1px solid ${T.rowBorder || T.border}`, fontSize:FONT.sm.size + 1, color:T.textSub };
  const fmt = (x, texte) => {
    if (texte) return texte;
    if (!x) return "—";
    if (x.ouvres) return x.ouvres + " jours ouvrés";
    return x.mois + (x.mois > 1 ? " mois" : " mois");
  };
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:560 }}>
        <thead><tr><th style={th}>Étape</th><th style={th}>Délai standard</th><th style={th}>En secteur ABF</th></tr></thead>
        <tbody>
          {URBA_DELAIS.map(d => {
            const actif = surligne === d.id;
            return (
              <tr key={d.id} style={actif ? { background:T.accentBg } : undefined}>
                <td style={{ ...td, color:actif ? T.accent : T.text, fontWeight:actif ? 800 : 600 }}>{d.etape}</td>
                <td style={{ ...td, fontFamily:"'DM Mono',monospace" }}>{fmt(d.std, d.texte)}</td>
                <td style={{ ...td, fontFamily:"'DM Mono',monospace", color:WA }}>{fmt(d.abf, d.texteAbf)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============ Écran 2 — la FDU ============ */

const ONGLETS = [
  { id:"demande", label:"Demande",       icon:FileText,      aide:"Blocs 1 à 3" },
  { id:"projet",  label:"Projet",        icon:Home,          aide:"Blocs 4 à 9" },
  { id:"pieces",  label:"Pièces",        icon:ListChecks,    aide:"Checklist et grille" },
  { id:"retro",   label:"Rétroplanning", icon:CalendarClock, aide:"Délais et dépôt" },
  { id:"process", label:"Process",       icon:ClipboardList, aide:"Todo, contrôle, visas" },
];

// Fusion profonde avec le dossier vide : une FDU enregistrée avant l'ajout d'un
// champ doit s'ouvrir sans trou, et sans écraser ce qui est déjà saisi.
function fusion(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch)) {
    const b = out[k], p = patch[k];
    out[k] = (b && p && typeof b === "object" && typeof p === "object" && !Array.isArray(b) && !Array.isArray(p))
      ? fusion(b, p) : p;
  }
  return out;
}

function FicheFDU({ dossier, profil, T = T_DEFAUT, onRetour }) {
  const [d, setD] = useState(() => fusion(urbaDossierVide(), dossier?.donnees || {}));
  const [statut, setStatut] = useState(dossier?.statut || "brouillon");
  const [onglet, setOnglet] = useState("demande");
  const [sync, setSync] = useState("");
  const [erreur, setErreur] = useState("");

  const saveTimer = useRef(null);
  const enAttente = useRef(null);
  const premierRendu = useRef(true);
  const transmisLe = useRef(dossier?.transmis_le || null);

  const comp = useMemo(() => urbaCompletude(d), [d]);
  const retro = useMemo(() => urbaRetroplanning({ ...d, _statut:statut }), [d, statut]);
  const arch = useMemo(() => urbaArchitecte(d), [d]);

  /* ---- Sauvegarde automatique ---- */
  const ecrire = useCallback(async () => {
    const patch = enAttente.current;
    if (!patch) return;
    try {
      await majDossier(dossier.id, patch);
      if (enAttente.current === patch) enAttente.current = null;
      setSync("Enregistré");
      setErreur("");
    } catch (e) {
      setSync("");
      setErreur("Enregistrement impossible : " + (e.message || e));
    }
  }, [dossier.id]);

  useEffect(() => {
    if (premierRendu.current) { premierRendu.current = false; return; }
    enAttente.current = {
      ...urbaColonnes(d, statut),
      statut,
      ...(transmisLe.current ? { transmis_le:transmisLe.current } : {}),
    };
    setSync("Modifications non enregistrées");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(ecrire, 1200);
  }, [d, statut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rattrapage au démontage : la seconde d'édition qui précède un « ← Suivi »
  // ne doit pas partir à la poubelle.
  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    if (enAttente.current) majDossier(dossier.id, enAttente.current).catch(() => {});
  }, [dossier.id]);

  /* ---- Écriture dans le dossier ---- */
  const set = useCallback((bloc, champ, valeur) => {
    setD(prev => ({ ...prev, [bloc]: { ...(prev[bloc] || {}), [champ]:valeur } }));
  }, []);
  const setSous = useCallback((bloc, sous, champ, valeur) => {
    setD(prev => ({
      ...prev,
      [bloc]: { ...(prev[bloc] || {}), [sous]: { ...((prev[bloc] || {})[sous] || {}), [champ]:valeur } },
    }));
  }, []);
  const setRacine = useCallback((champ, valeur) => setD(prev => ({ ...prev, [champ]:valeur })), []);

  /* ---- Transitions de statut ---- */
  const changerStatut = (s) => {
    if (s === "transmis" && !comp.transmissible) {
      alert(
        "FDU incomplète : elle ne peut pas être transmise.\n\n"
        + (comp.manquants.length ? comp.manquants.length + " champ(s) obligatoire(s) manquant(s).\n" : "")
        + (comp.pieces.length ? comp.pieces.length + " pièce(s) obligatoire(s) non reçue(s).\n" : "")
        + "\nLe détail est dans l'onglet Process."
      );
      setOnglet("process");
      return;
    }
    setStatut(s);
    if (s === "transmis") {
      const v = d.validation || {};
      if (!txt(v.commercial_date)) set("validation", "commercial_date", urbaISO(new Date()));
      if (!txt(v.commercial_nom)) set("validation", "commercial_nom", profil?.nom || "");
      if (!transmisLe.current) transmisLe.current = new Date().toISOString();
    }
    if (s === "depose" && !txt(d?.suivi?.date_depot)) set("suivi", "date_depot", urbaISO(new Date()));
    if (s === "pieces_mairie" && !txt(d?.suivi?.date_pieces_mairie)) set("suivi", "date_pieces_mairie", urbaISO(new Date()));
    if (s === "accorde" && !txt(d?.suivi?.date_decision)) {
      set("suivi", "date_decision", urbaISO(new Date()));
      set("suivi", "decision", "Accordé");
    }
  };

  const actionPrincipale = () => {
    if (["brouillon", "attente_pieces"].includes(statut)) {
      return { label:"Transmettre au pôle urbanisme", icon:Send, cible:"transmis", bloque:!comp.transmissible };
    }
    if (statut === "transmis") return { label:"Marquer complet", icon:Check, cible:"complet" };
    if (statut === "complet") return { label:"Enregistrer le dépôt", icon:Landmark, cible:"depose" };
    if (statut === "depose") return { label:"Autorisation accordée", icon:Check, cible:"accorde" };
    if (statut === "pieces_mairie") return { label:"Pièces envoyées, instruction relancée", icon:RefreshCw, cible:"depose" };
    if (statut === "accorde") return { label:"Recours purgé", icon:Check, cible:"purge" };
    return null;
  };
  const action = actionPrincipale();

  const couleurComp = comp.pct >= 100 ? SU : comp.pct >= 60 ? WA : DA;
  const ref = txt(d?.identification?.reference) || dossier?.reference || "Sans référence";
  const adresse = [d?.bien?.adresse, d?.bien?.code_postal, d?.bien?.commune].filter(Boolean).join(", ");

  return (
    <div style={{ padding:"18px 28px 40px", maxWidth:1500, margin:"0 auto" }}>
      {/* Topbar */}
      <div style={{ display:"flex", gap:SPACING.md, alignItems:"flex-start", flexWrap:"wrap",
        borderBottom:`1px solid ${T.border}`, paddingBottom:SPACING.md, marginBottom:SPACING.lg }}>
        <button className="inv-btn inv-btn-out inv-btn-sm" onClick={onRetour}><Icon as={ArrowLeft} size={12}/>Suivi</button>
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ display:"flex", alignItems:"center", gap:SPACING.sm, flexWrap:"wrap" }}>
            <span style={{ fontSize:FONT.xl.size, fontWeight:800, color:T.text }}>{ref}</span>
            <BadgeStatut statut={statut} T={T}/>
            {urbaEstABF(d) && <Etiquette color={WA} T={T}>Secteur ABF</Etiquette>}
            {d?.nature?.autorisation && <Etiquette color={T.accent} T={T}>{d.nature.autorisation}</Etiquette>}
          </div>
          <div style={{ fontSize:FONT.sm.size + 1, color:T.textMuted, marginTop:3 }}>
            {adresse || "Adresse non renseignée"} · {d?.identification?.entite} · {d?.identification?.commercial || "commercial à préciser"}
          </div>
        </div>
        <div style={{ minWidth:190 }}>
          <CompletionBar label={`Complétude ${comp.ok}/${comp.total}`} value={comp.pct} color={couleurComp} T={T}/>
          <div style={{ fontSize:FONT.xs.size, color:sync === "Enregistré" ? SU : T.textMuted, textAlign:"right" }}>{sync || " "}</div>
        </div>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap", alignItems:"center" }}>
          <select className="inv-sel" value={statut} onChange={e => changerStatut(e.target.value)} title="Statut du dossier">
            {URBA_STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="inv-btn inv-btn-out inv-btn-sm" onClick={() => imprimerFDU({ ...dossier, statut, donnees:d })}>
            <Icon as={Printer} size={12}/>Imprimer la FDU
          </button>
          {action && (
            <button className="inv-btn inv-btn-sm inv-btn-accent" onClick={() => changerStatut(action.cible)}
              title={action.bloque ? "FDU incomplète : voir l'onglet Process" : ""}
              style={action.bloque ? { opacity:.55 } : undefined}>
              <Icon as={action.icon} size={12}/>{action.label}
            </button>
          )}
        </div>
      </div>

      {erreur && <div style={{ marginBottom:SPACING.md }}><Bandeau level="danger" T={T}>{erreur}</Bandeau></div>}

      {/* Alertes transverses : elles suivent l'utilisateur sur tous les onglets */}
      <div style={{ display:"grid", gap:SPACING.sm, marginBottom:SPACING.lg }}>
        {!comp.transmissible && URBA_STATUTS_AVANT_DEPOT.includes(statut) && (
          <Bandeau level={comp.manquants.length + comp.pieces.length > 6 ? "danger" : "warning"} T={T}>
            FDU incomplète — {comp.manquants.length} champ(s) obligatoire(s) et {comp.pieces.length} pièce(s) manquants.
            Tant que ce n'est pas soldé, le dossier n'est pas pris en charge.
            {" "}<button className="inv-btn inv-btn-sm inv-btn-out" onClick={() => setOnglet("process")}>Voir le détail</button>
          </Bandeau>
        )}
        {comp.transmissible && statut === "brouillon" && (
          <Bandeau level="success" T={T}>FDU complète : elle peut être transmise au pôle urbanisme.</Bandeau>
        )}
        {arch.obligatoire && (
          <Bandeau level="warning" T={T}>
            <strong>Architecte obligatoire.</strong> {arch.motif} Budget et délai du dossier impactés : à valider avec le client avant de promettre une date.
          </Bandeau>
        )}
        {retro.alertes.map((a, i) => <Bandeau key={i} level={a.level} T={T}>{a.label}</Bandeau>)}
      </div>

      {/* Onglets */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:SPACING.lg }}>
        {ONGLETS.map(o => {
          const actif = onglet === o.id;
          return (
            <button key={o.id} className={"inv-btn inv-btn-sm " + (actif ? "inv-btn-accent" : "inv-btn-out")}
              onClick={() => setOnglet(o.id)} title={o.aide}>
              <Icon as={o.icon} size={12}/>{o.label}
              {o.id === "pieces" && comp.pieces.length > 0 && (
                <span style={{ marginLeft:5, color:actif ? "#0f172a" : DA, fontWeight:900 }}>{comp.pieces.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {onglet === "demande" && <OngletDemande d={d} set={set} setSous={setSous} setD={setD} T={T} arch={arch}/>}
      {onglet === "projet"  && <OngletProjet  d={d} set={set} setSous={setSous} setD={setD} setRacine={setRacine} T={T}/>}
      {onglet === "pieces"  && <OngletPieces  d={d} set={set} setSous={setSous} T={T}/>}
      {onglet === "retro"   && <OngletRetro   d={d} set={set} T={T} retro={retro} statut={statut}/>}
      {onglet === "process" && <OngletProcess d={d} set={set} setSous={setSous} T={T} comp={comp} statut={statut} onAllerPieces={() => setOnglet("pieces")}/>}
    </div>
  );
}

/* ---- Onglet 1 : Demande (blocs 1, 2, 3) ---- */

function OngletDemande({ d, set, setSous, setD, T, arch }) {
  const id = d.identification || {};
  const dem = d.demandeur || {};
  const b = d.bien || {};
  const societe = urbaSocieteExistante(d);
  const siret = txt(dem.societe?.siret).replace(/\s/g, "");

  const majCadastre = (idx, champ, v) => setD(prev => ({
    ...prev,
    bien: { ...prev.bien, cadastre: (prev.bien.cadastre || []).map((p, i) => i === idx ? { ...p, [champ]:v } : p) },
  }));
  const ajouterParcelle = () => setD(prev => ({
    ...prev,
    bien: { ...prev.bien, cadastre:[...(prev.bien.cadastre || []), { id:"p" + Date.now(), section:"", numero:"", surface:"" }] },
  }));
  const retirerParcelle = (idx) => setD(prev => ({
    ...prev,
    bien: { ...prev.bien, cadastre:(prev.bien.cadastre || []).filter((_, i) => i !== idx) },
  }));

  return (
    <>
      <Carte titre="Bloc 1 — Identification de la demande" icone={FileText} ton="blue" T={T}>
        <div style={GRILLE_CHAMPS}>
          <Txt label="N° de dossier / référence chantier" value={id.reference} requis T={T} onChange={v => set("identification", "reference", v)}/>
          <Sel label="Entité concernée" value={id.entite} options={URBA_ENTITES} requis T={T} onChange={v => set("identification", "entite", v)}/>
          <Txt label="Commercial demandeur" value={id.commercial} requis T={T} onChange={v => set("identification", "commercial", v)}/>
          <Dte label="Date de la demande" value={id.date_demande} requis T={T} onChange={v => set("identification", "date_demande", v)}/>
          <Dte label="Date maximum de dépôt" value={id.date_max_depot} requis T={T} onChange={v => set("identification", "date_max_depot", v)}
            aide="Elle pilote tout le rétroplanning"/>
          <Sel label="Origine de la contrainte de date" value={id.origine_contrainte} options={URBA_ORIGINES_CONTRAINTE} requis T={T}
            onChange={v => set("identification", "origine_contrainte", v)}/>
          {id.origine_contrainte === "Autre" && (
            <Txt label="Préciser l'origine de la contrainte" value={id.origine_autre} requis T={T} onChange={v => set("identification", "origine_autre", v)}/>
          )}
          <Dte label="Date prévisionnelle de signature notaire" value={id.date_notaire} T={T} onChange={v => set("identification", "date_notaire", v)}/>
          <Dte label="Date prévisionnelle démarrage travaux" value={id.date_travaux} requis T={T} onChange={v => set("identification", "date_travaux", v)}
            aide="Comparée à la date de purge des recours"/>
          <Sel label="Le client est-il déjà propriétaire ?" value={id.deja_proprietaire} options={["Oui", "Non"]} requis T={T}
            onChange={v => set("identification", "deja_proprietaire", v)}
            aide={id.deja_proprietaire === "Non" ? "Compromis ou autorisation du propriétaire à joindre" : ""}/>
        </div>
      </Carte>

      <Carte titre="Bloc 2 — Le demandeur" icone={Building2} ton="blue" T={T}
        action={
          <select className="inv-sel" value={dem.type || "societe"} onChange={e => set("demandeur", "type", e.target.value)}>
            <option value="societe">Société existante</option>
            <option value="a_creer">Société non encore créée</option>
          </select>
        }>
        {societe ? (
          <div style={GRILLE_CHAMPS}>
            <Txt label="Dénomination sociale" value={dem.societe?.denomination} requis T={T} onChange={v => setSous("demandeur", "societe", "denomination", v)}/>
            <Txt label="Forme juridique" value={dem.societe?.forme} requis T={T} placeholder="SCI, SAS, SARL…" onChange={v => setSous("demandeur", "societe", "forme", v)}/>
            <Txt label="SIRET (14 chiffres)" value={dem.societe?.siret} requis T={T} onChange={v => setSous("demandeur", "societe", "siret", v)}
              aide={siret && siret.length !== 14 ? `${siret.length}/14 chiffres — incomplet` : "Oubli n°3 des relances"}/>
            <Txt label="Adresse du siège social" value={dem.societe?.adresse_siege} requis T={T} span onChange={v => setSous("demandeur", "societe", "adresse_siege", v)}/>
            <Txt label="Nom / prénom du représentant légal" value={dem.societe?.representant} requis T={T} onChange={v => setSous("demandeur", "societe", "representant", v)}/>
            <Txt label="Qualité" value={dem.societe?.qualite} requis T={T} placeholder="gérant, président…" onChange={v => setSous("demandeur", "societe", "qualite", v)}/>
            <Txt label="Téléphone du représentant" value={dem.societe?.telephone} T={T} onChange={v => setSous("demandeur", "societe", "telephone", v)}/>
            <Txt label="Email du représentant" value={dem.societe?.email} T={T} onChange={v => setSous("demandeur", "societe", "email", v)}/>
          </div>
        ) : (
          <div style={GRILLE_CHAMPS}>
            <Txt label="Nom / prénom du futur dirigeant" value={dem.futur?.nom} requis T={T} onChange={v => setSous("demandeur", "futur", "nom", v)}/>
            <Dte label="Date de naissance" value={dem.futur?.naissance_date} requis T={T} onChange={v => setSous("demandeur", "futur", "naissance_date", v)}/>
            <Txt label="Lieu de naissance" value={dem.futur?.naissance_lieu} requis T={T} onChange={v => setSous("demandeur", "futur", "naissance_lieu", v)}/>
            <Txt label="Adresse personnelle complète" value={dem.futur?.adresse} requis T={T} span onChange={v => setSous("demandeur", "futur", "adresse", v)}/>
            <Txt label="Téléphone" value={dem.futur?.telephone} requis T={T} onChange={v => setSous("demandeur", "futur", "telephone", v)}/>
            <Txt label="Email" value={dem.futur?.email} T={T} onChange={v => setSous("demandeur", "futur", "email", v)}/>
            <Dte label="Date prévisionnelle d'immatriculation" value={dem.futur?.date_immatriculation} T={T} onChange={v => setSous("demandeur", "futur", "date_immatriculation", v)}/>
            <Sel label="Dépôt au nom du particulier avec transfert ultérieur ?" value={dem.futur?.depot_particulier} options={["Oui", "Non"]} T={T}
              onChange={v => setSous("demandeur", "futur", "depot_particulier", v)}/>
          </div>
        )}

        <div style={{ marginTop:SPACING.md, display:"grid", gap:SPACING.sm }}>
          <Bandeau level={arch.obligatoire ? "warning" : "info"} T={T}>
            <strong>Point de vigilance à faire remonter au client.</strong> Si le demandeur est une personne morale (SCI, SAS…),
            le recours à un architecte est obligatoire pour tout permis de construire, sans seuil de surface. Pour une personne
            physique, l'exemption ne joue que jusqu'à 150 m² de surface de plancher. Cela change le budget et le délai du
            dossier : à valider avant de promettre une date.
            {arch.motif && <><br/><strong>Sur ce dossier :</strong> {arch.motif}</>}
          </Bandeau>
          <Chk label="Le point architecte a été remonté au client" checked={dem.architecte_alerte}
            onChange={v => set("demandeur", "architecte_alerte", v)} T={T} color={SU}/>
        </div>
      </Carte>

      <Carte titre="Bloc 3 — Le bien" icone={MapPin} ton="blue" T={T}>
        <div style={GRILLE_CHAMPS}>
          <Txt label="Adresse (n°, rue)" value={b.adresse} requis T={T} onChange={v => set("bien", "adresse", v)}/>
          <Txt label="Code postal" value={b.code_postal} T={T} onChange={v => set("bien", "code_postal", v)}/>
          <Txt label="Commune" value={b.commune} requis T={T} onChange={v => set("bien", "commune", v)}/>
          <Txt label="Zone PLU (si connue)" value={b.zone_plu} T={T} onChange={v => set("bien", "zone_plu", v)}/>
          <Sel label="Périmètre ABF / site patrimonial remarquable" value={b.abf} options={["Oui", "Non", "À vérifier"]} requis T={T}
            vide="À vérifier" onChange={v => set("bien", "abf", v)}
            aide={b.abf === "À vérifier" ? "À trancher avant de communiquer un délai" : b.abf === "Oui" ? "Délais majorés, bloc 6 rédhibitoire" : ""}/>
          <Sel label="Bien en copropriété ?" value={b.copro} options={["Oui", "Non"]} requis T={T} onChange={v => set("bien", "copro", v)}/>
          <Sel label="Bien occupé ou vacant ?" value={b.occupation} options={["Occupé", "Vacant"]} requis T={T} onChange={v => set("bien", "occupation", v)}/>
          <Sel label="Assainissement" value={b.assainissement} options={["Collectif", "Individuel"]} requis T={T} onChange={v => set("bien", "assainissement", v)}/>
          <Txt label="Contact sur place — nom" value={b.contact_nom} requis T={T} onChange={v => set("bien", "contact_nom", v)}
            aide="Pour les photos et les mesures"/>
          <Txt label="Contact sur place — téléphone" value={b.contact_tel} requis T={T} onChange={v => set("bien", "contact_tel", v)}/>
          <Txt label="Servitudes connues" value={b.servitudes} T={T} span placeholder="passage, cour commune, mitoyenneté…"
            onChange={v => set("bien", "servitudes", v)}/>
        </div>

        <div style={{ marginTop:SPACING.md, display:"grid", gap:SPACING.sm }}>
          {b.copro === "Oui" && (
            <Chk label="Les travaux touchent les parties communes ou les façades (accord d'AG requis)"
              checked={b.copro_parties_communes} onChange={v => set("bien", "copro_parties_communes", v)} T={T} color={WA}/>
          )}
          <Chk label="Façade non visible depuis la rue (Google Maps inexploitable : photos terrain indispensables)"
            checked={b.facade_non_visible} onChange={v => set("bien", "facade_non_visible", v)} T={T} color={WA}/>
        </div>

        <div style={{ marginTop:SPACING.lg }}>
          <div style={{ display:"flex", alignItems:"center", gap:SPACING.sm, marginBottom:SPACING.sm }}>
            <span style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.text }}>Références cadastrales</span>
            <span style={{ fontSize:FONT.xs.size, color:T.textMuted }}>section + numéro + surface de chaque parcelle</span>
            <button className="inv-btn inv-btn-sm inv-btn-out" style={{ marginLeft:"auto" }} onClick={ajouterParcelle}>
              <Icon as={Plus} size={11}/>Parcelle
            </button>
          </div>
          {(b.cadastre || []).map((p, i) => (
            <div key={p.id || i} style={{ display:"flex", gap:SPACING.sm, alignItems:"flex-end", marginBottom:SPACING.sm, flexWrap:"wrap" }}>
              <div style={{ width:120 }}><Txt label="Section" value={p.section} requis={i === 0} T={T} onChange={v => majCadastre(i, "section", v)}/></div>
              <div style={{ width:120 }}><Txt label="Numéro" value={p.numero} requis={i === 0} T={T} onChange={v => majCadastre(i, "numero", v)}/></div>
              <div style={{ width:140 }}><Txt label="Surface (m²)" value={p.surface} T={T} onChange={v => majCadastre(i, "surface", v)}/></div>
              {(b.cadastre || []).length > 1 && (
                <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => retirerParcelle(i)}><Icon as={Trash2} size={11}/></button>
              )}
            </div>
          ))}
        </div>
      </Carte>
    </>
  );
}

/* ---- Onglet 2 : Projet (blocs 4 à 9) ---- */

function OngletProjet({ d, set, setSous, setD, setRacine, T }) {
  const nat = d.nature || {};
  const natures = nat.natures || [];
  const grille = urbaGrilleActive(d);

  const basculer = (natureId, coche) => {
    setD(prev => {
      const cour = prev.nature?.natures || [];
      return {
        ...prev,
        nature: { ...prev.nature, natures: coche ? [...cour, natureId] : cour.filter(x => x !== natureId) },
      };
    });
  };

  return (
    <>
      <Carte titre="Bloc 4 — Nature de la demande" icone={ListChecks} ton="blue" T={T}
        sous={natures.length ? `${natures.length} nature(s) cochée(s)` : "Aucune nature cochée"}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:SPACING.sm, marginBottom:SPACING.md }}>
          {URBA_NATURES.map(n => (
            <div key={n.id}>
              <Chk label={n.label + (n.aide ? ` (${n.aide})` : "")} checked={natures.includes(n.id)}
                onChange={v => basculer(n.id, v)} T={T} color={T.accent}/>
              {natures.includes(n.id) && n.blocs.length > 0 && (
                <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginLeft:24 }}>
                  → à compléter : {n.blocs.map(x => ({ division:"bloc 5", facade:"bloc 6", surfaces:"bloc 7", stationnement:"bloc 8" }[x])).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={GRILLE_CHAMPS}>
          {natures.includes("autre") && (
            <Txt label="Préciser « Autre »" value={nat.autre_precision} requis T={T} onChange={v => set("nature", "autre_precision", v)}/>
          )}
          <Sel label="Autorisation retenue" value={nat.autorisation} options={URBA_AUTORISATIONS} vide="À trancher" T={T}
            onChange={v => set("nature", "autorisation", v)}
            aide="La commune et le PLU font foi — le pôle urbanisme tranche après vérification"/>
          <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
            <span style={{ fontSize:FONT.xs.size + 1, fontWeight:700, color:T.textSub }}>Cas particulier</span>
            <span style={{ paddingTop:6 }}>
              <Chk label="PC de maison individuelle (délai d'instruction réduit)" checked={nat.pc_maison_individuelle}
                onChange={v => set("nature", "pc_maison_individuelle", v)} T={T} color={T.accent}/>
            </span>
          </div>
        </div>

        {grille.length > 0 && (
          <div style={{ marginTop:SPACING.lg }}>
            <div style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.text, marginBottom:SPACING.sm }}>
              Ce qu'il faut fournir pour ces natures
            </div>
            <GrilleTypes lignes={grille} T={T}/>
            <div style={{ marginTop:SPACING.sm }}>
              <Bandeau level="info" T={T}>Grille indicative : la commune et le PLU font foi. Le pôle urbanisme tranche après vérification.</Bandeau>
            </div>
          </div>
        )}
      </Carte>

      {urbaDivisionConcernee(d) && <BlocDivision d={d} set={set} setSous={setSous} setD={setD} T={T}/>}
      {urbaFacadeConcernee(d) && <BlocFacade d={d} set={set} setD={setD} T={T}/>}
      {urbaSurfacesConcernees(d) && <BlocSurfaces d={d} setD={setD} T={T}/>}
      {urbaStationnementConcerne(d) && <BlocStationnement d={d} set={set} T={T}/>}

      <Carte titre="Bloc 9 — Informations complémentaires" icone={Info} ton="blue" T={T} sous="Champ libre obligatoire">
        <Area label="Contraintes du client, échanges déjà eus avec la mairie, particularités du bien, éléments de négociation liés à l'autorisation"
          value={d.complement} requis rows={6} T={T} onChange={v => setRacine("complement", v)}
          placeholder="Tout ce qui évite un aller-retour."/>
      </Carte>
    </>
  );
}

function GrilleTypes({ lignes, T = T_DEFAUT, complet }) {
  const th = { padding:"6px 7px", borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size,
    textTransform:"uppercase", letterSpacing:.8, color:T.textMuted, textAlign:"left", fontWeight:800, whiteSpace:"nowrap" };
  const td = { padding:"6px 7px", borderBottom:`1px solid ${T.rowBorder || T.border}`, fontSize:FONT.sm.size, color:T.textSub, verticalAlign:"top" };
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:900 }}>
        <thead><tr>
          <th style={th}>Type de travaux</th><th style={th}>Autorisation probable</th><th style={th}>Plans niveaux</th>
          <th style={th}>Plans façades</th><th style={th}>Photos</th><th style={th}>Détail menuiseries</th><th style={th}>Surfaces</th>
        </tr></thead>
        <tbody>
          {lignes.map(g => (
            <tr key={g.nature}>
              <td style={{ ...td, color:T.text, fontWeight:700 }}>{g.travaux}</td>
              <td style={{ ...td, color:T.accent, fontWeight:700 }}>{g.autorisation}</td>
              <td style={td}>{g.plansNiveaux}</td>
              <td style={td}>{g.plansFacades}</td>
              <td style={td}>{g.photos}</td>
              <td style={{ ...td, color:/^Oui/.test(g.menuiseries) ? WA : undefined }}>{g.menuiseries}</td>
              <td style={td}>{g.surfaces}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlocDivision({ d, set, setSous, setD, T }) {
  const dv = d.division || {};
  const logements = dv.logements || [];
  const maj = (i, champ, v) => setD(prev => ({
    ...prev,
    division: { ...prev.division, logements:(prev.division.logements || []).map((g, k) => k === i ? { ...g, [champ]:v } : g) },
  }));
  const ajouter = () => setD(prev => ({
    ...prev,
    division: { ...prev.division, logements:[...(prev.division.logements || []), urbaLogementVide((prev.division.logements || []).length + 1)] },
  }));
  const retirer = (i) => setD(prev => ({
    ...prev,
    division: { ...prev.division, logements:(prev.division.logements || []).filter((_, k) => k !== i) },
  }));

  const th = { padding:"6px", borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size, textTransform:"uppercase",
    letterSpacing:.8, color:T.textMuted, textAlign:"left", fontWeight:800, whiteSpace:"nowrap" };
  const td = { padding:"4px", borderBottom:`1px solid ${T.rowBorder || T.border}` };
  const inp = { width:"100%", textAlign:"left", fontSize:FONT.sm.size };

  return (
    <Carte titre="Bloc 5 — Division" icone={Layers} ton="mid" T={T} sous={`${logements.length} logement(s) décrit(s)`}>
      <div style={GRILLE_CHAMPS}>
        <Txt label="Nombre de logements avant" value={dv.nb_avant} requis T={T} onChange={v => set("division", "nb_avant", v)}/>
        <Txt label="Nombre de logements après" value={dv.nb_apres} requis T={T} onChange={v => set("division", "nb_apres", v)}/>
        <Sel label="Type d'exploitation visé" value={dv.exploitation} requis T={T}
          options={["Nu", "Meublé", "Colocation", "Location courte durée"]} onChange={v => set("division", "exploitation", v)}/>
        <Sel label="Accès aux logements" value={dv.acces} options={["Commun", "Indépendant"]} requis T={T} onChange={v => set("division", "acces", v)}/>
        <Txt label="Précision sur les accès" value={dv.acces_precision} T={T} onChange={v => set("division", "acces_precision", v)}/>
      </div>

      <div style={{ marginTop:SPACING.md, display:"flex", gap:SPACING.lg, flexWrap:"wrap" }}>
        <span style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.textSub }}>Création de compteurs individuels</span>
        {[["eau", "Eau"], ["elec", "Électricité"], ["gaz", "Gaz"]].map(([k, l]) => (
          <span key={k} style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:FONT.sm.size + 1, color:T.textSub }}>{l}</span>
            <select className="inv-sel" value={dv.compteurs?.[k] || ""} onChange={e => setSous("division", "compteurs", k, e.target.value)}>
              <option value="">—</option><option>Oui</option><option>Non</option>
            </select>
          </span>
        ))}
      </div>

      <div style={{ marginTop:SPACING.lg }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:SPACING.sm }}>
          <span style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.text }}>Détail par logement</span>
          <button className="inv-btn inv-btn-sm inv-btn-out" style={{ marginLeft:"auto" }} onClick={ajouter}>
            <Icon as={Plus} size={11}/>Logement
          </button>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:720 }}>
            <thead><tr>
              <th style={th}>N°</th><th style={th}>Niveau</th><th style={th}>Typologie</th>
              <th style={th}>Surface habitable (m²)</th><th style={th}>Surface de plancher (m²)</th><th style={th}/>
            </tr></thead>
            <tbody>
              {logements.map((g, i) => (
                <tr key={g.id || i}>
                  <td style={td}><input className="inv-inp" value={g.numero || ""} onChange={e => maj(i, "numero", e.target.value)} style={{ ...inp, width:70 }}/></td>
                  <td style={td}><input className="inv-inp" value={g.niveau || ""} placeholder="RDC, R+1…" onChange={e => maj(i, "niveau", e.target.value)} style={inp}/></td>
                  <td style={td}><input className="inv-inp" value={g.typologie || ""} placeholder="T2" onChange={e => maj(i, "typologie", e.target.value)} style={inp}/></td>
                  <td style={td}><input className="inv-inp" value={g.surface_habitable || ""} onChange={e => maj(i, "surface_habitable", e.target.value)} style={inp}/></td>
                  <td style={td}><input className="inv-inp" value={g.surface_plancher || ""} onChange={e => maj(i, "surface_plancher", e.target.value)} style={inp}/></td>
                  <td style={{ ...td, textAlign:"right" }}>
                    {logements.length > 1 && <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => retirer(i)}><Icon as={Trash2} size={11}/></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Carte>
  );
}

// Bloc 6 — le point n°1 de blocage. Aucune demande ne part sans ce tableau
// rempli ligne par ligne : chaque case vide est signalée en rouge, et le
// compteur en tête de carte dit combien de lignes sont encore incomplètes.
function BlocFacade({ d, set, setD, T }) {
  const fa = d.facade || {};
  const lignes = fa.lignes || [];
  const naturesSet = new Set(d.nature?.natures || []);
  const abf = urbaEstABF(d);

  const maj = (i, champ, v) => setD(prev => ({
    ...prev,
    facade: { ...prev.facade, lignes:(prev.facade.lignes || []).map((l, k) => k === i ? { ...l, [champ]:v } : l) },
  }));
  const ajouter = () => setD(prev => ({
    ...prev,
    facade: { ...prev.facade, lignes:[...(prev.facade.lignes || []), urbaLigneFacadeVide((prev.facade.lignes || []).length + 1)] },
  }));
  const retirer = (i) => setD(prev => ({
    ...prev,
    facade: { ...prev.facade, lignes:(prev.facade.lignes || []).filter((_, k) => k !== i) },
  }));

  const remplies = urbaLignesFacade(d);
  const incompletes = remplies.filter(l => urbaLigneFacadeManques(l).length > 0).length;

  const th = { padding:"6px 5px", borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size, textTransform:"uppercase",
    letterSpacing:.6, color:T.textMuted, textAlign:"left", fontWeight:800, whiteSpace:"nowrap" };
  const td = { padding:"3px 4px", borderBottom:`1px solid ${T.rowBorder || T.border}`, verticalAlign:"middle" };
  const cel = (l, champ, largeur, placeholder) => {
    const requis = urbaLigneFacadeManques(l).includes(champ);
    return (
      <input className="inv-inp" value={l[champ] || ""} placeholder={placeholder || ""}
        onChange={e => maj(lignes.indexOf(l), champ, e.target.value)}
        style={{ width:largeur || "100%", minWidth:largeur || 90, textAlign:"left", fontSize:FONT.sm.size,
          borderColor:requis ? DA : undefined }}/>
    );
  };

  return (
    <Carte titre="Bloc 6 — Façades et toiture, ligne par ligne" icone={Ruler} ton={incompletes ? "danger" : "mid"} T={T}
      sous={remplies.length ? `${remplies.length} ligne(s) · ${incompletes} incomplète(s)` : "Aucune ligne renseignée"}
      action={<button className="inv-btn inv-btn-sm inv-btn-out" onClick={ajouter}><Icon as={Plus} size={11}/>Ligne</button>}>

      <div style={{ marginBottom:SPACING.md }}>
        <Bandeau level={abf ? "danger" : "warning"} T={T}>
          Aucune demande ne part sans ce tableau rempli ligne par ligne. C'est le point n°1 de blocage
          {abf ? " — et c'est rédhibitoire en secteur ABF, ce qui est le cas de ce dossier." : "."}
        </Bandeau>
      </div>

      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1400 }}>
          <thead><tr>
            <th style={th}>N°</th><th style={th}>Façade</th><th style={th}>Niveau</th><th style={th}>Pièce</th>
            <th style={th}>Existant</th><th style={th}>Projeté</th><th style={th}>L × H (cm)</th>
            <th style={th}>Matériau</th><th style={th}>Couleur / RAL</th><th style={th}>Type d'ouverture</th>
            <th style={th}>Modèle / réf. fournisseur</th><th style={th}/>
          </tr></thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={l.id || i}>
                <td style={{ ...td, color:T.textMuted, fontFamily:"'DM Mono',monospace", fontSize:FONT.sm.size }}>{i + 1}</td>
                <td style={td}>{cel(l, "facade", 130, "Nord — rue X")}</td>
                <td style={td}>{cel(l, "niveau", 80, "R+1")}</td>
                <td style={td}>{cel(l, "piece", 100, "Chambre 1")}</td>
                <td style={td}>{cel(l, "existant", 160, "fenêtre bois 2 vantaux")}</td>
                <td style={td}>{cel(l, "projete", 160, "fenêtre PVC 2 vantaux")}</td>
                <td style={{ ...td, whiteSpace:"nowrap" }}>
                  <span style={{ display:"inline-flex", gap:4, alignItems:"center" }}>
                    {cel(l, "largeur", 60, "L")}<span style={{ color:T.textMuted }}>×</span>{cel(l, "hauteur", 60, "H")}
                  </span>
                </td>
                <td style={td}>
                  <select className="inv-sel" value={l.materiau || ""} onChange={e => maj(i, "materiau", e.target.value)}
                    style={{ minWidth:90, borderColor:urbaLigneFacadeManques(l).includes("materiau") ? DA : undefined }}>
                    <option value="">—</option><option>PVC</option><option>Alu</option><option>Bois</option><option>Mixte</option><option>Autre</option>
                  </select>
                </td>
                <td style={td}>{cel(l, "couleur", 110, "RAL 7016")}</td>
                <td style={td}>
                  <select className="inv-sel" value={l.type_ouverture || ""} onChange={e => maj(i, "type_ouverture", e.target.value)}
                    style={{ minWidth:120, borderColor:urbaLigneFacadeManques(l).includes("type_ouverture") ? DA : undefined }}>
                    <option value="">—</option><option>Oscillo-battant</option><option>Coulissant</option><option>Fixe</option>
                    <option>À la française</option><option>Soufflet</option><option>Porte</option><option>Fenêtre de toit</option>
                  </select>
                </td>
                <td style={td}>{cel(l, "modele", 150)}</td>
                <td style={{ ...td, textAlign:"right" }}>
                  {lignes.length > 1 && <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => retirer(i)}><Icon as={Trash2} size={11}/></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...GRILLE_CHAMPS, marginTop:SPACING.lg }}>
        <Txt label="Type de vitrage" value={fa.vitrage} requis T={T} placeholder="double vitrage 4/16/4" onChange={v => set("facade", "vitrage", v)}/>
        <Sel label="Présence de petits bois" value={fa.petits_bois} options={["Oui", "Non"]} T={T} onChange={v => set("facade", "petits_bois", v)}/>
        <Txt label="Volets" value={fa.volets} requis T={T} placeholder="battants / roulants, coffre intérieur ou extérieur"
          onChange={v => set("facade", "volets", v)}/>
        {naturesSet.has("velux") && (
          <Txt label="Velux — versant de toiture, dimensions exactes, modèle, encastré ou non" value={fa.velux_precisions} requis T={T} span
            onChange={v => set("facade", "velux_precisions", v)}/>
        )}
        {naturesSet.has("ouverture") && (
          <Txt label="Création — cotes de positionnement (distance au nu du mur, hauteur d'allège)" value={fa.cotes_positionnement} requis T={T} span
            onChange={v => set("facade", "cotes_positionnement", v)}/>
        )}
      </div>
    </Carte>
  );
}

function BlocSurfaces({ d, setD, T }) {
  const bats = d.surfaces?.batiments || [];
  const maj = (i, champ, v) => setD(prev => ({
    ...prev,
    surfaces: { ...prev.surfaces, batiments:(prev.surfaces.batiments || []).map((b, k) => k === i ? { ...b, [champ]:v } : b) },
  }));
  const ajouter = () => setD(prev => ({
    ...prev,
    surfaces: { ...prev.surfaces, batiments:[...(prev.surfaces.batiments || []), urbaBatimentVide("Annexe")] },
  }));
  const retirer = (i) => setD(prev => ({
    ...prev,
    surfaces: { ...prev.surfaces, batiments:(prev.surfaces.batiments || []).filter((_, k) => k !== i) },
  }));

  const LIGNES = [
    { cle:"emprise",  label:"Emprise au sol (m²)",     requis:true },
    { cle:"plancher", label:"Surface de plancher (m²)", requis:true },
    { cle:"taxable",  label:"Surface taxable (m²)",     requis:false },
    { cle:"niveaux",  label:"Nombre de niveaux",        requis:false },
  ];
  const th = { padding:"6px", borderBottom:`1px solid ${T.border}`, fontSize:FONT.xs.size, textTransform:"uppercase",
    letterSpacing:.8, color:T.textMuted, textAlign:"left", fontWeight:800 };
  const td = { padding:"4px 6px", borderBottom:`1px solid ${T.rowBorder || T.border}` };
  const sp = urbaSurfacePlancherTotale(d);

  return (
    <Carte titre="Bloc 7 — Surfaces" icone={Ruler} ton="mid" T={T}
      sous={sp > 0 ? `${sp.toFixed(0)} m² de surface de plancher après travaux` : "Bâtiment par bâtiment"}
      action={<button className="inv-btn inv-btn-sm inv-btn-out" onClick={ajouter}><Icon as={Plus} size={11}/>Bâtiment</button>}>
      {bats.map((b, i) => (
        <div key={b.id || i} style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, padding:SPACING.md, marginBottom:SPACING.md }}>
          <div style={{ display:"flex", gap:SPACING.sm, alignItems:"flex-end", marginBottom:SPACING.sm }}>
            <div style={{ flex:1, maxWidth:320 }}>
              <Txt label="Bâtiment" value={b.nom} T={T} placeholder="Bâtiment principal, annexe, garage, dépendance…"
                onChange={v => maj(i, "nom", v)}/>
            </div>
            {bats.length > 1 && <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => retirer(i)}><Icon as={Trash2} size={11}/></button>}
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:560 }}>
              <thead><tr>
                <th style={th}>Donnée</th><th style={th}>Existant</th><th style={th}>Créé / supprimé</th><th style={th}>Total après travaux</th>
              </tr></thead>
              <tbody>
                {LIGNES.map(l => {
                  const ke = l.cle + "_existant", kc = l.cle + "_cree";
                  const manque = l.requis && !txt(b[ke]);
                  return (
                    <tr key={l.cle}>
                      <td style={{ ...td, color:T.textSub, fontSize:FONT.sm.size + 1, fontWeight:600 }}>
                        {l.label}{l.requis && <span style={{ color:manque ? DA : T.textMuted }}> *</span>}
                      </td>
                      <td style={td}><input className="inv-inp" value={b[ke] || ""} onChange={e => maj(i, ke, e.target.value)}
                        style={{ width:110, borderColor:manque ? DA : undefined }}/></td>
                      <td style={td}><input className="inv-inp" value={b[kc] || ""} onChange={e => maj(i, kc, e.target.value)} style={{ width:110 }}/></td>
                      <td style={{ ...td, fontFamily:"'DM Mono',monospace", color:T.accent, fontWeight:800 }}>
                        {urbaTotal(b[ke], b[kc]) || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <Bandeau level="info" T={T}>
        Le total après travaux est calculé automatiquement. Au-delà de 150 m² de surface de plancher, une personne physique
        perd l'exemption d'architecte.
      </Bandeau>
    </Carte>
  );
}

function BlocStationnement({ d, set, T }) {
  const s = d.stationnement || {};
  return (
    <Carte titre="Bloc 8 — Stationnement" icone={Car} ton="mid" T={T}>
      <div style={GRILLE_CHAMPS}>
        <Sel label="Stationnement possible sur la parcelle ?" value={s.possible} options={["Oui", "Non"]} requis T={T}
          onChange={v => set("stationnement", "possible", v)}/>
        {s.possible === "Oui" && <>
          <Txt label="Nombre de places" value={s.nb_places} requis T={T} onChange={v => set("stationnement", "nb_places", v)}/>
          <Txt label="Emplacement précis (reporté sur le plan de masse)" value={s.emplacement} requis T={T} span
            onChange={v => set("stationnement", "emplacement", v)}/>
          <Txt label="Places couvertes" value={s.couvertes} T={T} onChange={v => set("stationnement", "couvertes", v)}/>
          <Txt label="Places non couvertes" value={s.non_couvertes} T={T} onChange={v => set("stationnement", "non_couvertes", v)}/>
        </>}
        {s.possible === "Non" && <>
          <Sel label="Demande de dérogation à formuler" value={s.derogation} options={["Oui", "Non"]} requis T={T}
            onChange={v => set("stationnement", "derogation", v)}/>
          {s.derogation === "Oui" && (
            <Txt label="Justification de la dérogation" value={s.derogation_justification} requis T={T} span
              onChange={v => set("stationnement", "derogation_justification", v)}/>
          )}
        </>}
        <Sel label="Local vélo prévu ?" value={s.local_velo} options={["Oui", "Non", "Sans objet"]} T={T} onChange={v => set("stationnement", "local_velo", v)}/>
        <Sel label="Local poubelles prévu ?" value={s.local_poubelles} options={["Oui", "Non", "Sans objet"]} T={T} onChange={v => set("stationnement", "local_poubelles", v)}/>
      </div>
    </Carte>
  );
}

/* ---- Onglet 3 : Pièces ---- */

function OngletPieces({ d, set, setSous, T }) {
  const exigences = urbaExigences(d);
  const obligatoires = exigences.filter(p => p.requis);
  const autres = exigences.filter(p => !p.requis);
  const manquantes = obligatoires.filter(p => p.manquante).length;

  const majPiece = (pieceId, champ, v) => setSous("pieces", pieceId, champ, v);

  const Ligne = ({ p }) => {
    const meta = urbaPieceStatut(p.statut);
    return (
      <div style={{ border:`1px solid ${p.manquante ? DA + "55" : T.border}`, background:p.manquante ? DA + "0d" : T.input,
        borderRadius:RADIUS.lg, padding:SPACING.md, marginBottom:SPACING.sm }}>
        <div style={{ display:"flex", gap:SPACING.sm, alignItems:"flex-start", flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:260 }}>
            <div style={{ fontSize:FONT.sm.size + 2, fontWeight:800, color:T.text, lineHeight:1.35 }}>
              {p.label}{p.requis && <span style={{ color:p.manquante ? DA : SU }}> *</span>}
            </div>
            <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, marginTop:3 }}>
              {p.format} · {p.quand} · produit par {p.producteur}
            </div>
          </div>
          <Etiquette color={p.requis ? (p.manquante ? DA : SU) : T.textMuted} T={T}>
            {p.requis ? (p.manquante ? "obligatoire — manquante" : "obligatoire — au dossier") : "non requise ici"}
          </Etiquette>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(130px,150px) minmax(140px,1fr) minmax(180px,2fr)", gap:SPACING.sm, marginTop:SPACING.sm }}>
          <select className="inv-sel" value={p.statut} onChange={e => majPiece(p.id, "statut", e.target.value)}
            style={{ borderColor:p.manquante ? DA : meta.color + "77", color:meta.color }}>
            {URBA_PIECE_STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input className="inv-inp" value={p.responsable} placeholder={"Qui s'en occupe (" + p.producteur.split(" (")[0] + ")"}
            onChange={e => majPiece(p.id, "responsable", e.target.value)} style={{ width:"100%", textAlign:"left" }}/>
          <span style={{ display:"flex", gap:6 }}>
            <input className="inv-inp" value={p.lien} placeholder="Lien Drive du chantier"
              onChange={e => majPiece(p.id, "lien", e.target.value)} style={{ flex:1, textAlign:"left" }}/>
            <button className="inv-btn inv-btn-sm inv-btn-out" disabled={!txt(p.lien)}
              onClick={() => window.open(p.lien, "_blank", "noopener")} title="Ouvrir le lien">
              <Icon as={LinkIcon} size={11}/>
            </button>
          </span>
        </div>
        <input className="inv-inp" value={p.commentaire} placeholder="Commentaire (format, version, ce qui reste à obtenir…)"
          onChange={e => majPiece(p.id, "commentaire", e.target.value)}
          style={{ width:"100%", textAlign:"left", marginTop:SPACING.sm }}/>
      </div>
    );
  };

  return (
    <>
      <Carte titre="Pièces à joindre" icone={ListChecks} ton={manquantes ? "danger" : "green"} T={T}
        sous={`${obligatoires.length - manquantes}/${obligatoires.length} pièce(s) obligatoire(s) au dossier`}>
        <div style={{ marginBottom:SPACING.md }}>
          <Bandeau level={manquantes ? "warning" : "success"} T={T}>
            {manquantes
              ? `${manquantes} pièce(s) obligatoire(s) encore absente(s). Une pièce ne compte qu'à partir de « Reçue » : « Demandée » ne protège de rien le jour du dépôt.`
              : "Toutes les pièces obligatoires de ce dossier sont au moins reçues."}
          </Bandeau>
        </div>
        {obligatoires.map(p => <Ligne key={p.id} p={p}/>)}

        {autres.length > 0 && (
          <div style={{ marginTop:SPACING.lg }}>
            <div style={{ fontSize:FONT.sm.size + 1, fontWeight:800, color:T.textMuted, marginBottom:SPACING.sm }}>
              Pièces non requises pour ce dossier (à renseigner si la mairie les demande)
            </div>
            {autres.map(p => <Ligne key={p.id} p={p}/>)}
          </div>
        )}
      </Carte>

      <Carte titre="Cadrage des photos" icone={Camera} ton="blue" T={T} sous="À transmettre aux équipes terrain">
        <ul style={{ margin:0, paddingLeft:20, color:T.textSub, fontSize:FONT.sm.size + 1, lineHeight:1.8 }}>
          {URBA_CADRAGE_PHOTOS.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
        <div style={{ marginTop:SPACING.md }}>
          <Bandeau level="info" T={T}>
            Nommage des fichiers : <strong style={{ fontFamily:"'DM Mono',monospace" }}>{URBA_NOMMAGE_FICHIERS}</strong>
            {d?.bien?.facade_non_visible && " — ce bien a une façade non visible depuis la rue : les photos terrain sont indispensables."}
          </Bandeau>
        </div>
      </Carte>

      <Carte titre="Grille — quoi fournir selon le type de demande" icone={ClipboardList} ton="gold" T={T} sous="Référence complète">
        <GrilleTypes lignes={URBA_GRILLE} T={T}/>
        <div style={{ marginTop:SPACING.sm }}>
          <Bandeau level="info" T={T}>Cette grille est indicative : la commune et le PLU font foi. Le pôle urbanisme tranche après vérification.</Bandeau>
        </div>
      </Carte>
    </>
  );
}

/* ---- Onglet 4 : Rétroplanning ---- */

function OngletRetro({ d, set, T, retro, statut }) {
  const s = d.suivi || {};
  const instr = urbaDelaiInstruction(d);
  const prep = urbaDelaiPreparation(d);
  const surligne = (d?.nature?.autorisation === "DP") ? "instr_dp"
    : (d?.nature?.autorisation === "PC" ? (d?.nature?.pc_maison_individuelle ? "instr_pc_mi" : "instr_pc") : null);

  return (
    <>
      <Carte titre="Rétroplanning du dossier" icone={CalendarClock} ton="gold" T={T}
        sous={`${retro.moisJusquauChantier} mois entre le dépôt et un chantier purgé de tout recours`}>
        {retro.alertes.length > 0 && (
          <div style={{ display:"grid", gap:SPACING.sm, marginBottom:SPACING.md }}>
            {retro.alertes.map((a, i) => <Bandeau key={i} level={a.level} T={T}>{a.label}</Bandeau>)}
          </div>
        )}

        <div style={{ display:"grid", gap:SPACING.sm }}>
          {retro.etapes.map((e, i) => {
            const reste = e.date ? urbaJoursRestants(urbaISO(e.date)) : null;
            const passe = reste !== null && reste < 0;
            const couleur = !e.date ? T.textMuted : passe ? T.textSub : reste <= 15 ? WA : T.accent;
            return (
              <div key={e.id} style={{ display:"flex", gap:SPACING.md, alignItems:"center",
                border:`1px solid ${couleur}44`, background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
                <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, background:couleur + "22", color:couleur,
                  display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontFamily:"'DM Mono',monospace" }}>{i + 1}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:FONT.sm.size + 2, fontWeight:800, color:T.text }}>{e.label}</div>
                  <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>{e.delai} · {e.aide}</div>
                </div>
                <div style={{ textAlign:"right", whiteSpace:"nowrap" }}>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontWeight:800, color:couleur }}>{e.date ? urbaFmtDate(e.date) : "—"}</div>
                  {reste !== null && (
                    <div style={{ fontSize:FONT.xs.size, color:couleur }}>{reste < 0 ? `il y a ${Math.abs(reste)} j` : `dans ${reste} j`}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop:SPACING.md }}>
          <Bandeau level="warning" T={T}>{URBA_REGLE_COMMERCIALE}</Bandeau>
        </div>

        <div style={{ ...GRILLE_CHAMPS, marginTop:SPACING.md }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <span style={{ fontSize:FONT.xs.size + 1, fontWeight:700, color:T.textSub }}>Régime retenu</span>
            <span style={{ fontSize:FONT.sm.size + 1, color:T.text, paddingTop:3 }}>
              {instr.libelle} — {instr.mois} mois{retro.abf ? " (secteur ABF)" : ""}
            </span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <span style={{ fontSize:FONT.xs.size + 1, fontWeight:700, color:T.textSub }}>Préparation en interne</span>
            <span style={{ fontSize:FONT.sm.size + 1, color:T.text, paddingTop:3 }}>
              {prep.ouvres} jours ouvrés ({prep.lourd ? "PC ou division" : "DP"}{retro.abf ? ", +5 ABF" : ""})
            </span>
          </div>
        </div>
      </Carte>

      <Carte titre="Suivi du dépôt et de l'instruction" icone={Landmark} ton="blue" T={T}>
        <div style={GRILLE_CHAMPS}>
          <Dte label="Date de dépôt effectif" value={s.date_depot} T={T} onChange={v => set("suivi", "date_depot", v)}/>
          <Txt label="Récépissé de dépôt (lien Drive)" value={s.recepisse_lien} T={T} onChange={v => set("suivi", "recepisse_lien", v)}/>
          <Dte label="Demande de pièces complémentaires reçue le" value={s.date_pieces_mairie} T={T} onChange={v => set("suivi", "date_pieces_mairie", v)}/>
          <Dte label="Pièces complémentaires envoyées le" value={s.date_reponse_pieces} T={T} onChange={v => set("suivi", "date_reponse_pieces", v)}
            aide="Relance le délai d'instruction à zéro"/>
          <Sel label="Décision" value={s.decision} options={["Accordé", "Accordé avec prescriptions", "Refusé", "Tacite"]} T={T}
            onChange={v => set("suivi", "decision", v)}/>
          <Dte label="Date de la décision" value={s.date_decision} T={T} onChange={v => set("suivi", "date_decision", v)}/>
          <Dte label="Affichage sur le terrain posé le" value={s.date_affichage} T={T} onChange={v => set("suivi", "date_affichage", v)}
            aide="Point de départ du recours des tiers"/>
        </div>
        <div style={{ display:"grid", gap:SPACING.sm, marginTop:SPACING.md }}>
          <Chk label="Échéance de fin d'instruction posée dans l'agenda partagé Urbanisme" checked={s.agenda_pose}
            onChange={v => set("suivi", "agenda_pose", v)} T={T} color={SU}/>
          <Chk label="Client informé de la date de purge du recours des tiers" checked={s.client_informe}
            onChange={v => set("suivi", "client_informe", v)} T={T} color={SU}/>
        </div>
      </Carte>

      <Carte titre="Délais de référence" icone={Clock} ton="gold" T={T} sous="La ligne applicable à ce dossier est surlignée">
        <TableauDelais T={T} surligne={surligne}/>
      </Carte>
    </>
  );
}

/* ---- Onglet 5 : Process ---- */

function OngletProcess({ d, set, setSous, T, comp, statut, onAllerPieces }) {
  const v = d.validation || {};
  const todo = d.todo || {};
  const parBloc = useMemo(() => {
    const m = new Map();
    comp.manquants.forEach(x => {
      if (!m.has(x.bloc)) m.set(x.bloc, []);
      m.get(x.bloc).push(x.label);
    });
    return Array.from(m.entries());
  }, [comp.manquants]);

  const totalTodo = URBA_TODO.reduce((n, e) => n + e.items.length, 0);
  const faitsTodo = URBA_TODO.reduce((n, e) => n + e.items.filter(i => todo[i.id]).length, 0);

  return (
    <>
      <Carte titre="Contrôle avant transmission" icone={ShieldAlert} ton={comp.transmissible ? "green" : "danger"} T={T}
        sous={comp.transmissible ? "FDU complète" : `${comp.manquants.length} champ(s) + ${comp.pieces.length} pièce(s) manquants`}>
        {comp.transmissible ? (
          <Bandeau level="success" T={T}>
            Tous les champs obligatoires applicables sont remplis et toutes les pièces obligatoires sont au dossier.
            La FDU peut partir au pôle urbanisme.
          </Bandeau>
        ) : (
          <>
            <Bandeau level="danger" T={T}>
              Une FDU incomplète n'est pas prise en charge et repart au commercial. Voici précisément ce qui manque.
            </Bandeau>
            {parBloc.length > 0 && (
              <div style={{ marginTop:SPACING.md, display:"grid", gap:SPACING.sm }}>
                {parBloc.map(([bloc, labels]) => (
                  <div key={bloc} style={{ border:`1px solid ${DA}44`, borderRadius:RADIUS.lg, padding:SPACING.md, background:T.input }}>
                    <div style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:DA, marginBottom:5 }}>Bloc {bloc}</div>
                    <ul style={{ margin:0, paddingLeft:18, color:T.textSub, fontSize:FONT.sm.size + 1, lineHeight:1.7 }}>
                      {labels.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {comp.pieces.length > 0 && (
              <div style={{ marginTop:SPACING.sm, border:`1px solid ${DA}44`, borderRadius:RADIUS.lg, padding:SPACING.md, background:T.input }}>
                <div style={{ display:"flex", alignItems:"center", gap:SPACING.sm, marginBottom:5 }}>
                  <span style={{ fontSize:FONT.sm.size + 1, fontWeight:900, color:DA }}>Pièces manquantes</span>
                  <button className="inv-btn inv-btn-sm inv-btn-out" style={{ marginLeft:"auto" }} onClick={onAllerPieces}>
                    <Icon as={ListChecks} size={11}/>Ouvrir la checklist
                  </button>
                </div>
                <ul style={{ margin:0, paddingLeft:18, color:T.textSub, fontSize:FONT.sm.size + 1, lineHeight:1.7 }}>
                  {comp.pieces.map(p => <li key={p.id}>{p.label} <span style={{ color:T.textMuted }}>— {p.producteur}</span></li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </Carte>

      <Carte titre="Les 6 oublis à éliminer" icone={AlertTriangle} ton="danger" T={T}
        sous={`${URBA_OUBLIS.filter(o => o.test(d)).length}/6 soldés sur ce dossier`}>
        <div style={{ display:"grid", gap:SPACING.sm }}>
          {URBA_OUBLIS.map(o => {
            const ok = o.test(d);
            return (
              <div key={o.id} style={{ display:"flex", gap:SPACING.sm, alignItems:"center",
                border:`1px solid ${(ok ? SU : DA)}44`, background:T.input, borderRadius:RADIUS.md, padding:`${SPACING.sm}px ${SPACING.md}px` }}>
                <Icon as={ok ? Check : AlertTriangle} size={15} style={{ color:ok ? SU : DA, flexShrink:0 }}/>
                <span style={{ fontSize:FONT.sm.size + 1, color:ok ? T.textSub : T.text, fontWeight:ok ? 500 : 700 }}>
                  {o.label}{o.rang && <span style={{ color:DA, fontWeight:900 }}> — {o.rang}</span>}
                </span>
                <span style={{ marginLeft:"auto" }}><Etiquette color={ok ? SU : DA} T={T}>{ok ? "soldé" : "à traiter"}</Etiquette></span>
              </div>
            );
          })}
        </div>
      </Carte>

      <Carte titre="Todo du commercial — dans l'ordre" icone={ClipboardList} ton="blue" T={T} sous={`${faitsTodo}/${totalTodo} coché(s)`}>
        <div style={{ marginBottom:SPACING.md }}>
          <CompletionBar label="Avancement du process commercial" value={Math.round((faitsTodo / totalTodo) * 100)}
            color={faitsTodo === totalTodo ? SU : faitsTodo ? WA : DA} T={T}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:SPACING.md }}>
          {URBA_TODO.map(etape => {
            const faits = etape.items.filter(i => todo[i.id]).length;
            return (
              <div key={etape.id} style={{ border:`1px solid ${faits === etape.items.length ? SU + "55" : T.border}`,
                background:T.input, borderRadius:RADIUS.lg, padding:SPACING.md }}>
                <div style={{ fontSize:FONT.sm.size + 2, fontWeight:900, color:T.text, marginBottom:SPACING.sm }}>
                  {etape.titre}
                  <span style={{ float:"right", fontFamily:"'DM Mono',monospace", color:faits === etape.items.length ? SU : T.textMuted }}>
                    {faits}/{etape.items.length}
                  </span>
                </div>
                <div style={{ display:"grid", gap:7 }}>
                  {etape.items.map(i => (
                    <Chk key={i.id} label={i.label} checked={todo[i.id]}
                      onChange={val => set("todo", i.id, val)} T={T} color={SU}/>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Carte>

      <Carte titre="Bloc 10 — Validation" icone={UserCheck} ton="blue" T={T}>
        <div style={GRILLE_CHAMPS}>
          <Txt label="Commercial — nom (fiche complète et vérifiée)" value={v.commercial_nom} requis T={T} onChange={x => set("validation", "commercial_nom", x)}/>
          <Dte label="Commercial — date" value={v.commercial_date} requis T={T} onChange={x => set("validation", "commercial_date", x)}/>
          <Txt label="Commercial — visa" value={v.commercial_visa} requis T={T} placeholder="Initiales" onChange={x => set("validation", "commercial_visa", x)}/>
          <Txt label="Réception pôle urbanisme — nom" value={v.reception_nom} T={T} onChange={x => set("validation", "reception_nom", x)}/>
          <Dte label="Réception — date" value={v.reception_date} T={T} onChange={x => set("validation", "reception_date", x)}/>
          <Txt label="Réception — visa" value={v.reception_visa} T={T} onChange={x => set("validation", "reception_visa", x)}/>
        </div>
        <div style={{ marginTop:SPACING.md }}>
          <Area label="Observations du pôle urbanisme" value={v.notes} rows={3} T={T} onChange={x => set("validation", "notes", x)}
            placeholder="Ce qui a été corrigé, ce qui a été demandé au commercial, arbitrage DP / PC…"/>
        </div>
        <div style={{ marginTop:SPACING.md }}>
          <Bandeau level="info" T={T}>
            Statut actuel : <strong>{urbaStatut(statut).label}</strong> — {urbaStatut(statut).aide}
          </Bandeau>
        </div>
      </Carte>
    </>
  );
}

/* ============ Racine ============ */

export default function Urbanisme({ profil, T = T_DEFAUT }) {
  const [ouvert, setOuvert] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const ouvrir = async (row) => {
    if (row?.donnees && Object.keys(row.donnees).length) { setOuvert(row); return; }
    setChargement(true);
    try {
      const complet = await chargerDossier(row.id);
      setOuvert(complet);
      setErreur("");
    } catch (e) {
      setErreur("Ouverture impossible : " + (e.message || e));
    } finally {
      setChargement(false);
    }
  };

  if (chargement) {
    return <div style={{ padding:"40px 28px", color:T.textMuted, fontStyle:"italic" }}>Ouverture du dossier…</div>;
  }

  if (ouvert) {
    return <FicheFDU key={ouvert.id} dossier={ouvert} profil={profil} T={T} onRetour={() => setOuvert(null)}/>;
  }

  return (
    <>
      {erreur && <div style={{ padding:"18px 28px 0" }}><Bandeau level="danger" T={T}>{erreur}</Bandeau></div>}
      <ListeUrbanisme profil={profil} T={T} onOuvrir={ouvrir}/>
    </>
  );
}
