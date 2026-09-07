import React, { useMemo, useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { useIsMobile } from "../hooks";
import {
  Wrench, Search, X, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronDown,
  Warehouse, CalendarDays, ClipboardCheck, Upload, AlertTriangle, CheckCircle2,
} from "lucide-react";

// États possibles d'un outil (colonne materiel.etat) — échelle utilisée aussi
// par les audits mensuels.
const ETATS = {
  neuf:    { label: "Neuf",         color: "#4db8ff" },
  bon:     { label: "Bon état",     color: "#22c55e" },
  mauvais: { label: "Mauvais état", color: "#f59e0b" },
  hs:      { label: "Hors service", color: "#e05c5c" },
};

// Clé de sélection du bucket « matériel non affecté » (au dépôt).
const DEPOT = "__depot__";

// Au-delà de ce délai depuis le dernier audit, l'ouvrier est signalé « à auditer ».
const DELAI_AUDIT_JOURS = 31;

const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const normCode = (s) => String(s || "").trim().toUpperCase();
const dateFR = (iso) => {
  const d = iso ? new Date(iso + "T00:00:00") : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
};
const joursDepuis = (iso) => {
  const d = iso ? new Date(iso + "T00:00:00") : null;
  if (!d || isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

// Inventaire des équipes : qui détient quel matériel.
// Colonne de gauche = les ouvriers (prénoms du planning) + le dépôt ;
// clic sur un ouvrier = la liste des outils à sa disposition (code unique
// inscrit sur l'outil en évidence), audit mensuel et import Excel.
export default function PageInventaireEquipes({ T, branch = "renovation", ouvriers = [], profil = null }) {
  const acc = getBranchAccent(branch);
  const isMobile = useIsMobile();

  const [items, setItems] = useState([]);
  const [audits, setAudits] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [selection, setSelection] = useState(null); // prénom | DEPOT | null
  const [recherche, setRecherche] = useState("");
  const [modal, setModal] = useState(null);          // { item } — item.id absent = création
  const [auditEnCours, setAuditEnCours] = useState(false);
  const [importOuvert, setImportOuvert] = useState(false);

  const charger = useCallback(async () => {
    const [rMat, rAud] = await Promise.all([
      supabase.from("materiel").select("*").order("nom", { ascending: true }),
      supabase.from("materiel_audits").select("*").order("date_audit", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    if (rMat.error) { setErreur(rMat.error.message); setChargement(false); return; }
    setItems(rMat.data || []);
    // La table d'audits peut ne pas encore exister (migration pas lancée) :
    // on n'empêche pas la page de fonctionner pour autant.
    setAudits(rAud.error ? [] : rAud.data || []);
    setErreur("");
    setChargement(false);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // Dernier audit par ouvrier (les audits sont triés par date décroissante).
  const dernierAudit = useMemo(() => {
    const m = {};
    audits.forEach((a) => { if (!m[a.ouvrier_prenom]) m[a.ouvrier_prenom] = a; });
    return m;
  }, [audits]);

  // Liste des détenteurs : les prénoms du planning, plus les prénoms trouvés
  // dans l'inventaire mais absents du planning (anciens ouvriers qui ont
  // encore du matériel — il ne faut surtout pas les masquer).
  const detenteurs = useMemo(() => {
    const connus = new Set(ouvriers.map((o) => normalize(o)));
    const anciens = [...new Set(
      items.map((i) => i.ouvrier_prenom).filter((p) => p && !connus.has(normalize(p)))
    )].sort((a, b) => a.localeCompare(b, "fr"));
    const compte = {};
    items.forEach((i) => {
      const k = i.ouvrier_prenom || DEPOT;
      compte[k] = (compte[k] || 0) + 1;
    });
    return {
      liste: [
        ...ouvriers.map((p) => ({ prenom: p, ancien: false, nb: compte[p] || 0 })),
        ...anciens.map((p) => ({ prenom: p, ancien: true, nb: compte[p] || 0 })),
      ],
      nbDepot: compte[DEPOT] || 0,
    };
  }, [items, ouvriers]);

  // Recherche globale (code, nom, catégorie, détenteur, notes) : répond à
  // « qui a l'outil P-012 ? » sans avoir à ouvrir chaque ouvrier.
  const resultatsRecherche = useMemo(() => {
    const q = normalize(recherche.trim());
    if (!q) return null;
    return items.filter((i) =>
      normalize([i.code, i.nom, i.categorie, i.ouvrier_prenom, i.notes].join(" ")).includes(q)
    );
  }, [items, recherche]);

  const itemsSelection = useMemo(() => {
    if (!selection) return [];
    return items.filter((i) => (selection === DEPOT ? !i.ouvrier_prenom : i.ouvrier_prenom === selection));
  }, [items, selection]);

  const auditsSelection = useMemo(
    () => (selection && selection !== DEPOT ? audits.filter((a) => a.ouvrier_prenom === selection) : []),
    [audits, selection]
  );

  const categoriesExistantes = useMemo(
    () => [...new Set(items.map((i) => i.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")),
    [items]
  );

  // ── Écritures ──
  const enregistrer = async (form) => {
    const ligne = {
      code: form.code.trim(),
      nom: form.nom.trim(),
      categorie: form.categorie.trim() || null,
      ouvrier_prenom: form.ouvrier_prenom || null,
      date_remise: form.date_remise || null,
      etat: form.etat,
      notes: form.notes.trim() || null,
      saisi_par: profil?.nom || profil?.email || null,
    };
    const req = form.id
      ? supabase.from("materiel").update(ligne).eq("id", form.id)
      : supabase.from("materiel").insert(ligne);
    const { error } = await req;
    if (error) {
      // 23505 = violation d'unicité : le code est déjà pris par un autre outil.
      if (error.code === "23505" || /duplicate|uniq/i.test(error.message)) {
        return `Le code « ${ligne.code} » est déjà attribué à un autre outil.`;
      }
      return error.message;
    }
    setModal(null);
    charger();
    return null;
  };

  const supprimer = async (item) => {
    if (!window.confirm(`Supprimer « ${item.nom} » (code ${item.code}) de l'inventaire ?`)) return;
    const { error } = await supabase.from("materiel").delete().eq("id", item.id);
    if (error) { alert(error.message); return; }
    charger();
  };

  // ── Sous-composants d'affichage ──
  const BadgeCode = ({ code }) => (
    <span style={{
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: FONT.sm.size, fontWeight: 800, letterSpacing: .8,
      color: acc.accent, background: acc.bg10, border: `1px solid ${acc.accent}44`,
      padding: "3px 9px", borderRadius: RADIUS.md, whiteSpace: "nowrap",
    }}>{code}</span>
  );

  const PilluleEtat = ({ etat }) => {
    const e = ETATS[etat] || ETATS.bon;
    return (
      <span style={{
        fontSize: FONT.xs.size, fontWeight: 700, color: e.color, background: `${e.color}1f`,
        padding: "2px 8px", borderRadius: 99,
      }}>{e.label}</span>
    );
  };

  const LigneMateriel = ({ item, montrerDetenteur = false }) => (
    <div style={{
      background: T.surface, border: `1px solid ${item.manquant ? "#e05c5c66" : T.border}`, borderRadius: RADIUS.lg,
      padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <BadgeCode code={item.code} />
          <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>{item.nom}</span>
          {item.categorie && (
            <span style={{
              fontSize: FONT.xs.size, fontWeight: 600, color: T.tagColor, background: T.tagBg,
              padding: "2px 8px", borderRadius: 99,
            }}>{item.categorie}</span>
          )}
          <PilluleEtat etat={item.etat} />
          {item.manquant && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: FONT.xs.size, fontWeight: 800, color: "#e05c5c", background: "#e05c5c1f",
              padding: "2px 8px", borderRadius: 99,
            }}>
              <Icon as={AlertTriangle} size={11} color="#e05c5c" /> Manquant au dernier audit
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
          {montrerDetenteur && (
            <button
              onClick={() => { setRecherche(""); setSelection(item.ouvrier_prenom || DEPOT); }}
              style={{
                background: "transparent", border: "none", padding: 0, cursor: "pointer",
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, color: acc.accent,
              }}>
              {item.ouvrier_prenom || "Au dépôt"}
            </button>
          )}
          {item.date_remise && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon as={CalendarDays} size={12} /> remis le {dateFR(item.date_remise)}
            </span>
          )}
          {item.notes && <span style={{ color: T.textSub }}>{item.notes}</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button className="ib" title="Modifier" onClick={() => setModal({ item })}>
          <Icon as={Pencil} size={14} />
        </button>
        <button className="ib" title="Supprimer" onClick={() => supprimer(item)} style={{ color: "#e05c5c" }}>
          <Icon as={Trash2} size={14} />
        </button>
      </div>
    </div>
  );

  const CarteDetenteur = ({ prenom, nb, ancien = false, depot = false }) => {
    const actif = selection === (depot ? DEPOT : prenom);
    const initiales = depot ? null : prenom.slice(0, 2).toUpperCase();
    const audit = depot ? null : dernierAudit[prenom];
    const jours = audit ? joursDepuis(audit.date_audit) : null;
    const aAuditer = !depot && nb > 0 && (!audit || (jours != null && jours > DELAI_AUDIT_JOURS));
    return (
      <button
        onClick={() => { setAuditEnCours(false); setSelection(depot ? DEPOT : prenom); }}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
          padding: "10px 12px", marginBottom: 6, cursor: "pointer", fontFamily: "inherit",
          background: actif ? acc.bg10 : T.surface,
          border: `1px solid ${actif ? acc.accent : T.border}`,
          borderRadius: RADIUS.lg, transition: "all .12s",
        }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
          background: depot ? T.tagBg : acc.bg20 || acc.bg10,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: FONT.xs.size + 1, fontWeight: 800, color: depot ? T.tagColor : acc.accent,
        }}>
          {depot ? <Icon as={Warehouse} size={15} color={T.tagColor} /> : initiales}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>
            {depot ? "Au dépôt (non affecté)" : prenom}
            {ancien && (
              <span style={{
                marginLeft: 6, fontSize: FONT.xs.size, fontWeight: 600, color: "#f59e0b",
                background: "#f59e0b1f", padding: "1px 7px", borderRadius: 99,
              }}>hors planning</span>
            )}
          </div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{nb} outil{nb > 1 ? "s" : ""}</span>
            {!depot && audit && <span>· audité le {dateFR(audit.date_audit)}</span>}
            {aAuditer && (
              <span style={{
                fontSize: FONT.xs.size, fontWeight: 800, color: "#f59e0b",
                background: "#f59e0b1f", padding: "1px 7px", borderRadius: 99,
              }}>à auditer</span>
            )}
          </div>
        </div>
        <Icon as={ChevronRight} size={15} color={actif ? acc.accent : T.textMuted} />
      </button>
    );
  };

  // ── Panneaux ──
  const panneauListe = (
    <div style={{ flex: isMobile ? 1 : "0 0 300px", minWidth: 0 }}>
      <div style={{
        fontSize: FONT.xs.size + 1, fontWeight: 800, letterSpacing: 1.1, textTransform: "uppercase",
        color: T.textMuted, margin: "0 0 10px 2px",
      }}>Équipe</div>
      {detenteurs.liste.map((d) => (
        <CarteDetenteur key={d.prenom} prenom={d.prenom} nb={d.nb} ancien={d.ancien} />
      ))}
      <div style={{ height: 1, background: T.sectionDivider, margin: "10px 0" }} />
      <CarteDetenteur depot prenom="" nb={detenteurs.nbDepot} />
    </div>
  );

  const auditSelection = selection && selection !== DEPOT ? dernierAudit[selection] : null;

  const panneauDetail = (
    <div style={{ flex: 1, minWidth: 0 }}>
      {selection ? (
        auditEnCours && selection !== DEPOT ? (
          <AuditOuvrier
            T={T} acc={acc}
            prenom={selection}
            items={itemsSelection}
            profil={profil}
            onAnnuler={() => setAuditEnCours(false)}
            onTermine={() => { setAuditEnCours(false); charger(); }}
          />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              {isMobile && (
                <button className="ib" title="Retour" onClick={() => setSelection(null)}>
                  <Icon as={ChevronLeft} size={16} />
                </button>
              )}
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.text, flex: 1 }}>
                {selection === DEPOT ? "Matériel au dépôt" : `Matériel de ${selection}`}
                <span style={{ marginLeft: 8, fontSize: FONT.sm.size, fontWeight: 600, color: T.textMuted }}>
                  {itemsSelection.length} outil{itemsSelection.length > 1 ? "s" : ""}
                </span>
              </h2>
              {selection !== DEPOT && itemsSelection.length > 0 && (
                <button className="btn-g" onClick={() => setAuditEnCours(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon as={ClipboardCheck} size={14} /> Démarrer l'audit
                </button>
              )}
              <button className="btn-p" onClick={() => setModal({ item: { ouvrier_prenom: selection === DEPOT ? "" : selection } })}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon as={Plus} size={14} /> Ajouter
              </button>
            </div>
            {selection !== DEPOT && (
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "0 0 12px 2px" }}>
                {auditSelection
                  ? <>Dernier audit le {dateFR(auditSelection.date_audit)}{auditSelection.audite_par ? ` par ${auditSelection.audite_par}` : ""}{auditSelection.nb_manquants > 0 ? ` — ${auditSelection.nb_manquants} manquant${auditSelection.nb_manquants > 1 ? "s" : ""}` : " — rien à signaler"}</>
                  : "Jamais audité."}
              </div>
            )}
            {itemsSelection.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "48px 16px", color: T.textMuted,
                border: `1px dashed ${T.border}`, borderRadius: RADIUS.lg, fontSize: FONT.sm.size + 1,
              }}>
                Aucun matériel {selection === DEPOT ? "au dépôt" : `affecté à ${selection}`} pour l'instant.
              </div>
            ) : (
              itemsSelection.map((i) => <LigneMateriel key={i.id} item={i} />)
            )}
            {auditsSelection.length > 0 && (
              <HistoriqueAudits T={T} acc={acc} audits={auditsSelection} />
            )}
          </>
        )
      ) : (
        <div style={{
          textAlign: "center", padding: "60px 16px", color: T.textMuted, fontSize: FONT.sm.size + 1,
          border: `1px dashed ${T.border}`, borderRadius: RADIUS.lg,
        }}>
          Sélectionnez un ouvrier pour voir le matériel mis à sa disposition.
        </div>
      )}
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px 60px" }}>

        {/* ── En-tête ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{
            width: 44, height: 44, borderRadius: RADIUS.md, background: acc.bg10,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={Wrench} size={22} color={acc.accent} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: .2 }}>
              Inventaire des équipes
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: FONT.sm.size, color: T.textSub }}>
              Le matériel mis à disposition de chaque ouvrier, identifié par le code inscrit sur l'outil.
            </p>
          </div>
          <button className="btn-g" onClick={() => setImportOuvert(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon as={Upload} size={14} /> Importer
          </button>
          <button className="btn-p" onClick={() => setModal({ item: {} })}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon as={Plus} size={14} /> Nouvel outil
          </button>
        </div>

        {/* ── Recherche globale ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, margin: "18px 0 20px",
          background: T.inputBg, border: `1px solid ${T.fieldBorder}`,
          borderRadius: RADIUS.md, padding: "8px 12px",
        }}>
          <Icon as={Search} size={15} color={T.textMuted} />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher un code (ex. P-012), un outil, un ouvrier…"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 1,
            }}
          />
          {recherche && (
            <button onClick={() => setRecherche("")} title="Effacer" style={{
              background: "transparent", border: "none", cursor: "pointer", padding: 2,
              color: T.textMuted, display: "flex",
            }}>
              <Icon as={X} size={14} />
            </button>
          )}
        </div>

        {erreur && (
          <div style={{
            padding: "10px 14px", marginBottom: 14, borderRadius: RADIUS.md,
            background: "rgba(224,92,92,0.08)", border: "1px solid rgba(224,92,92,0.3)",
            color: "#e05c5c", fontSize: FONT.sm.size + 1,
          }}>
            {/relation .* does not exist/i.test(erreur)
              ? "La table « materiel » n'existe pas encore : lancez les migrations sql/202609_inventaire_equipes.sql puis sql/202609_materiel_audits.sql dans Supabase."
              : erreur}
          </div>
        )}

        {chargement ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.textMuted }}>Chargement…</div>
        ) : resultatsRecherche ? (
          /* ── Résultats de recherche à plat : répond à « qui a ce code ? » ── */
          <div>
            <div style={{ fontSize: FONT.sm.size + 1, color: T.textSub, marginBottom: 10 }}>
              {resultatsRecherche.length} résultat{resultatsRecherche.length > 1 ? "s" : ""} pour « {recherche.trim()} »
            </div>
            {resultatsRecherche.map((i) => <LigneMateriel key={i.id} item={i} montrerDetenteur />)}
            {resultatsRecherche.length === 0 && (
              <div style={{ textAlign: "center", padding: "48px 0", color: T.textMuted, fontSize: FONT.sm.size + 1 }}>
                Aucun outil ne correspond à cette recherche.
              </div>
            )}
          </div>
        ) : isMobile ? (
          selection ? panneauDetail : panneauListe
        ) : (
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            {panneauListe}
            {panneauDetail}
          </div>
        )}
      </div>

      {modal && (
        <ModalMateriel
          T={T} acc={acc}
          item={modal.item}
          ouvriers={ouvriers}
          categories={categoriesExistantes}
          onFermer={() => setModal(null)}
          onEnregistrer={enregistrer}
        />
      )}

      {importOuvert && (
        <ModalImport
          T={T} acc={acc}
          ouvriers={ouvriers}
          itemsExistants={items}
          profil={profil}
          onFermer={() => setImportOuvert(false)}
          onTermine={() => { setImportOuvert(false); charger(); }}
        />
      )}
    </div>
  );
}

// ─── Audit mensuel d'un ouvrier ──────────────────────────────────────────────
// Chaque outil doit être explicitement pointé « Présent » ou « Manquant »
// (l'état est pré-rempli avec l'état actuel, à corriger si besoin). La clôture
// enregistre l'instantané (materiel_audits + lignes) et met à jour chaque
// fiche outil (etat, manquant).
function AuditOuvrier({ T, acc, prenom, items, profil, onAnnuler, onTermine }) {
  const [lignes, setLignes] = useState(() => items.map((i) => ({
    materiel_id: i.id,
    code: i.code,
    nom: i.nom,
    present: null, // null = pas encore vérifié
    etat_constate: ETATS[i.etat] ? i.etat : "bon",
    commentaire: "",
  })));
  const [commentaire, setCommentaire] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  const setLigne = (idx, patch) => setLignes((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const nbVerifies = lignes.filter((l) => l.present !== null).length;
  const nbManquants = lignes.filter((l) => l.present === false).length;
  const complet = nbVerifies === lignes.length;

  const cloturer = async () => {
    if (!complet || enCours) return;
    setEnCours(true);
    setErreur("");
    const { data: audit, error: e1 } = await supabase
      .from("materiel_audits")
      .insert({
        ouvrier_prenom: prenom,
        date_audit: new Date().toLocaleDateString("sv-SE"),
        audite_par: profil?.nom || profil?.email || null,
        commentaire: commentaire.trim() || null,
        nb_total: lignes.length,
        nb_manquants: nbManquants,
      })
      .select()
      .single();
    if (e1) {
      setEnCours(false);
      setErreur(/relation .* does not exist/i.test(e1.message)
        ? "La table des audits n'existe pas encore : lancez sql/202609_materiel_audits.sql dans Supabase."
        : e1.message);
      return;
    }
    const { error: e2 } = await supabase.from("materiel_audit_lignes").insert(
      lignes.map((l) => ({
        audit_id: audit.id,
        materiel_id: l.materiel_id,
        code: l.code,
        nom: l.nom,
        present: l.present,
        etat_constate: l.etat_constate,
        commentaire: l.commentaire.trim() || null,
      }))
    );
    if (e2) { setEnCours(false); setErreur(e2.message); return; }
    // Mise à jour des fiches outils : état constaté + drapeau manquant.
    for (const l of lignes) {
      await supabase.from("materiel").update({
        etat: l.etat_constate,
        manquant: !l.present,
        saisi_par: profil?.nom || profil?.email || null,
      }).eq("id", l.materiel_id);
    }
    setEnCours(false);
    onTermine();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.text, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon as={ClipboardCheck} size={18} color={acc.accent} /> Audit de {prenom}
        </h2>
        <span style={{
          fontSize: FONT.sm.size, fontWeight: 700,
          color: complet ? "#22c55e" : T.textSub,
        }}>
          {nbVerifies}/{lignes.length} vérifié{nbVerifies > 1 ? "s" : ""}
        </span>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: FONT.xs.size + 1, color: T.textMuted }}>
        Pointez chaque outil « Présent » ou « Manquant », puis corrigez l'état constaté si besoin.
      </p>

      {lignes.map((l, idx) => {
        const verifie = l.present !== null;
        return (
          <div key={l.materiel_id} style={{
            background: T.surface,
            border: `1px solid ${l.present === false ? "#e05c5c66" : verifie ? "#22c55e44" : T.border}`,
            borderRadius: RADIUS.lg, padding: "12px 14px", marginBottom: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <span style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: FONT.sm.size, fontWeight: 800, letterSpacing: .8,
                color: acc.accent, background: acc.bg10, border: `1px solid ${acc.accent}44`,
                padding: "3px 9px", borderRadius: RADIUS.md,
              }}>{l.code}</span>
              <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text, flex: 1 }}>{l.nom}</span>
              {verifie && (
                <Icon as={l.present ? CheckCircle2 : AlertTriangle} size={16} color={l.present ? "#22c55e" : "#e05c5c"} />
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <button onClick={() => setLigne(idx, { present: true })} style={{
                padding: "7px 14px", borderRadius: RADIUS.md, cursor: "pointer", fontFamily: "inherit",
                fontSize: FONT.xs.size + 1, fontWeight: l.present === true ? 800 : 600,
                border: `1px solid ${l.present === true ? "#22c55e" : T.border}`,
                background: l.present === true ? "#22c55e1f" : "transparent",
                color: l.present === true ? "#22c55e" : T.textSub,
              }}>Présent</button>
              <button onClick={() => setLigne(idx, { present: false })} style={{
                padding: "7px 14px", borderRadius: RADIUS.md, cursor: "pointer", fontFamily: "inherit",
                fontSize: FONT.xs.size + 1, fontWeight: l.present === false ? 800 : 600,
                border: `1px solid ${l.present === false ? "#e05c5c" : T.border}`,
                background: l.present === false ? "#e05c5c1f" : "transparent",
                color: l.present === false ? "#e05c5c" : T.textSub,
              }}>Manquant</button>
              <span style={{ width: 1, height: 22, background: T.sectionDivider, margin: "0 4px" }} />
              {Object.entries(ETATS).map(([id, e]) => {
                const actif = l.etat_constate === id;
                const desactive = l.present === false;
                return (
                  <button key={id} disabled={desactive}
                    onClick={() => setLigne(idx, { etat_constate: id, present: l.present === null ? true : l.present })}
                    style={{
                      padding: "7px 10px", borderRadius: RADIUS.md, fontFamily: "inherit",
                      cursor: desactive ? "default" : "pointer", opacity: desactive ? .35 : 1,
                      fontSize: FONT.xs.size + 1, fontWeight: actif ? 800 : 600,
                      border: `1px solid ${actif ? e.color : T.border}`,
                      background: actif ? `${e.color}1f` : "transparent",
                      color: actif ? e.color : T.textSub,
                    }}>{e.label}</button>
                );
              })}
            </div>
            <input
              className="ti"
              value={l.commentaire}
              onChange={(e) => setLigne(idx, { commentaire: e.target.value })}
              placeholder="Remarque sur cet outil (facultatif)"
              style={{ marginTop: 8, fontSize: FONT.xs.size + 1 }}
            />
          </div>
        );
      })}

      <label style={{ display: "block", fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub, margin: "14px 0 4px" }}>
        Commentaire général de l'audit
      </label>
      <textarea className="ti" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={2}
        placeholder="ex. RAS, casque à remplacer le mois prochain" style={{ resize: "vertical" }} />

      {erreur && (
        <div style={{ marginTop: 12, color: "#e05c5c", fontSize: FONT.sm.size, fontWeight: 600 }}>{erreur}</div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 16 }}>
        {!complet && (
          <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginRight: "auto" }}>
            Pointez tous les outils pour pouvoir clôturer.
          </span>
        )}
        <button className="btn-g" onClick={onAnnuler}>Annuler</button>
        <button className="btn-p" onClick={cloturer} disabled={!complet || enCours}
          style={{ opacity: complet ? 1 : .5 }}>
          {enCours ? "Enregistrement…" : `Clôturer l'audit${nbManquants > 0 ? ` (${nbManquants} manquant${nbManquants > 1 ? "s" : ""})` : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─── Historique des audits d'un ouvrier ──────────────────────────────────────
function HistoriqueAudits({ T, acc, audits }) {
  const [ouvert, setOuvert] = useState(false);
  const [lignesPar, setLignesPar] = useState({}); // { [auditId]: lignes[] }
  const [detail, setDetail] = useState(null);     // auditId déplié

  const voirDetail = async (auditId) => {
    if (detail === auditId) { setDetail(null); return; }
    setDetail(auditId);
    if (!lignesPar[auditId]) {
      const { data } = await supabase.from("materiel_audit_lignes").select("*").eq("audit_id", auditId).order("code");
      setLignesPar((m) => ({ ...m, [auditId]: data || [] }));
    }
  };

  return (
    <div style={{ marginTop: 22 }}>
      <button onClick={() => setOuvert((o) => !o)} style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: "transparent", border: "none", padding: 0, cursor: "pointer",
        fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
        color: acc.accent, letterSpacing: .2,
      }}>
        <Icon as={ouvert ? ChevronDown : ChevronRight} size={14} />
        Audits précédents ({audits.length})
      </button>
      {ouvert && audits.map((a) => (
        <div key={a.id} style={{
          background: T.widgetBg, border: `1px solid ${T.sectionDivider}`,
          borderRadius: RADIUS.md, padding: "10px 12px", marginTop: 8,
        }}>
          <button onClick={() => voirDetail(a.id)} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
            background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
          }}>
            <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>
              {dateFR(a.date_audit)}
            </span>
            {a.audite_par && <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>par {a.audite_par}</span>}
            <span style={{ flex: 1 }} />
            <span style={{
              fontSize: FONT.xs.size, fontWeight: 700,
              color: a.nb_manquants > 0 ? "#e05c5c" : "#22c55e",
              background: a.nb_manquants > 0 ? "#e05c5c1f" : "#22c55e1f",
              padding: "2px 8px", borderRadius: 99,
            }}>
              {a.nb_manquants > 0 ? `${a.nb_manquants} manquant${a.nb_manquants > 1 ? "s" : ""}` : "complet"}
            </span>
            <Icon as={detail === a.id ? ChevronDown : ChevronRight} size={13} color={T.textMuted} />
          </button>
          {a.commentaire && (
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 4 }}>{a.commentaire}</div>
          )}
          {detail === a.id && (
            <div style={{ marginTop: 8 }}>
              {(lignesPar[a.id] || []).map((l) => {
                const e = ETATS[l.etat_constate] || ETATS.bon;
                return (
                  <div key={l.id} style={{
                    display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
                    padding: "5px 0", borderTop: `1px solid ${T.sectionDivider}`,
                    fontSize: FONT.xs.size + 1,
                  }}>
                    <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 700, color: T.text }}>{l.code}</span>
                    <span style={{ color: T.textSub, flex: 1 }}>{l.nom}</span>
                    {!l.present && <span style={{ color: "#e05c5c", fontWeight: 800 }}>MANQUANT</span>}
                    <span style={{ color: e.color, fontWeight: 700 }}>{e.label}</span>
                    {l.commentaire && <span style={{ color: T.textMuted }}>{l.commentaire}</span>}
                  </div>
                );
              })}
              {!lignesPar[a.id] && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Chargement…</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Modale de création / édition d'un outil ─────────────────────────────────
function ModalMateriel({ T, acc, item, ouvriers, categories, onFermer, onEnregistrer }) {
  const [form, setForm] = useState({
    id: item.id || null,
    code: item.code || "",
    nom: item.nom || "",
    categorie: item.categorie || "",
    ouvrier_prenom: item.ouvrier_prenom || "",
    date_remise: item.date_remise || "",
    etat: ETATS[item.etat] ? item.etat : "bon",
    notes: item.notes || "",
  });
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const valider = async () => {
    if (!form.code.trim()) { setErreur("Le code inscrit sur l'outil est obligatoire."); return; }
    if (!form.nom.trim()) { setErreur("Le nom de l'outil est obligatoire."); return; }
    setEnCours(true);
    const err = await onEnregistrer(form);
    setEnCours(false);
    if (err) setErreur(err);
  };

  const champ = { display: "block", fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub, margin: "12px 0 4px" };

  return (
    <div
      onClick={onFermer}
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,14,20,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto",
          background: T.modal || T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.xl, padding: 20,
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.text, flex: 1 }}>
            {form.id ? "Modifier l'outil" : "Nouvel outil"}
          </h3>
          <button className="ib" title="Fermer" onClick={onFermer}><Icon as={X} size={15} /></button>
        </div>

        <label style={champ}>Code inscrit sur l'outil *</label>
        <input className="ti" value={form.code} onChange={set("code")} placeholder="ex. P-012"
          style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 700, letterSpacing: .8 }} />

        <label style={champ}>Nom de l'outil *</label>
        <input className="ti" value={form.nom} onChange={set("nom")} placeholder="ex. Perceuse Makita 18V" />

        <label style={champ}>Catégorie</label>
        <input className="ti" value={form.categorie} onChange={set("categorie")}
          placeholder="ex. Électroportatif" list="materiel-categories" />
        <datalist id="materiel-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>

        <label style={champ}>Mis à disposition de</label>
        <select className="ti" value={form.ouvrier_prenom} onChange={set("ouvrier_prenom")}>
          <option value="">Au dépôt (non affecté)</option>
          {ouvriers.map((o) => <option key={o} value={o}>{o}</option>)}
          {form.ouvrier_prenom && !ouvriers.includes(form.ouvrier_prenom) && (
            <option value={form.ouvrier_prenom}>{form.ouvrier_prenom} (hors planning)</option>
          )}
        </select>

        <label style={champ}>Date de remise</label>
        <input className="ti" type="date" value={form.date_remise || ""} onChange={set("date_remise")} />

        <label style={champ}>État</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(ETATS).map(([id, e]) => {
            const actif = form.etat === id;
            return (
              <button key={id} onClick={() => setForm((f) => ({ ...f, etat: id }))} style={{
                flex: "1 1 90px", padding: "8px 4px", borderRadius: RADIUS.md, cursor: "pointer",
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: actif ? 800 : 600,
                border: `1px solid ${actif ? e.color : T.border}`,
                background: actif ? `${e.color}1f` : "transparent",
                color: actif ? e.color : T.textSub,
              }}>{e.label}</button>
            );
          })}
        </div>

        <label style={champ}>Notes</label>
        <textarea className="ti" value={form.notes} onChange={set("notes")} rows={2}
          placeholder="ex. batterie de rechange fournie" style={{ resize: "vertical" }} />

        {erreur && (
          <div style={{ marginTop: 12, color: "#e05c5c", fontSize: FONT.sm.size, fontWeight: 600 }}>{erreur}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn-g" onClick={onFermer}>Annuler</button>
          <button className="btn-p" onClick={valider} disabled={enCours}>
            {enCours ? "Enregistrement…" : form.id ? "Enregistrer" : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Import du Google Sheets (export .xlsx ou .csv) ──────────────────────────
// Le classeur peut avoir un onglet par ouvrier (le nom de l'onglet sert alors
// de détenteur) ou une colonne « Ouvrier ». Les colonnes sont auto-détectées
// depuis les en-têtes ; les codes déjà connus sont mis à jour, les autres créés.

// Mots-clés d'en-têtes par champ. L'ordre du tableau est l'ordre de priorité
// de détection (« nom » en dernier car trop générique : « nom ouvrier » doit
// matcher ouvrier, pas nom).
const COLONNES_IMPORT = [
  ["code",        ["code", "ref", "reference", "n°", "numero", "num"]],
  ["ouvrier",     ["ouvrier", "salarie", "prenom", "detenteur", "employe", "affecte", "equipe"]],
  ["etat",        ["etat", "condition"]],
  ["categorie",   ["categorie", "type", "famille"]],
  ["notes",       ["note", "commentaire", "observation", "remarque"]],
  ["date_remise", ["date", "remise", "attribution"]],
  ["nom",         ["nom", "materiel", "designation", "outil", "libelle", "description", "article", "equipement"]],
];

const mapEtatImport = (val) => {
  const n = normalize(val);
  if (!n) return "bon";
  if (n.includes("neuf")) return "neuf";
  if (n.includes("hs") || n.includes("hors") || n.includes("casse")) return "hs";
  if (n.includes("mauvais") || n.includes("use") || n.includes("abime")) return "mauvais";
  return "bon";
};

const mapDateImport = (val) => {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val.toLocaleDateString("sv-SE");
  const s = String(val).trim();
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return null;
};

function ModalImport({ T, acc, ouvriers, itemsExistants, profil, onFermer, onTermine }) {
  const [nomFichier, setNomFichier] = useState("");
  const [lignes, setLignes] = useState(null);      // lignes parsées
  const [avertissements, setAvertissements] = useState([]);
  const [mappingInconnus, setMappingInconnus] = useState({}); // { prenomSheet: valeur retenue }
  const [mode, setMode] = useState("upsert");      // upsert | nouveaux
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [resultat, setResultat] = useState(null);

  const ouvriersNorm = useMemo(() => {
    const m = new Map();
    ouvriers.forEach((o) => m.set(normalize(o), o));
    return m;
  }, [ouvriers]);

  const parCodeExistant = useMemo(() => {
    const m = new Map();
    itemsExistants.forEach((i) => m.set(normCode(i.code), i));
    return m;
  }, [itemsExistants]);

  const parserFichier = async (file) => {
    setErreur("");
    setNomFichier(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const toutes = [];
      const warns = [];

      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
        if (!rows.length) continue;

        // Détection de la ligne d'en-têtes : parmi les 5 premières lignes,
        // celle qui matche le plus de colonnes connues (au moins code ou nom).
        let entete = null, colonnes = null, meilleurScore = 0;
        for (let r = 0; r < Math.min(5, rows.length); r++) {
          const cand = {};
          rows[r].forEach((cell, c) => {
            const h = normalize(cell);
            if (!h) return;
            for (const [champ, cles] of COLONNES_IMPORT) {
              if (cand[champ] !== undefined) continue;
              if (cles.some((k) => h.includes(k))) { cand[champ] = c; break; }
            }
          });
          const score = Object.keys(cand).length;
          if (score > meilleurScore && (cand.code !== undefined || cand.nom !== undefined)) {
            meilleurScore = score; entete = r; colonnes = cand;
          }
        }
        if (!colonnes) { warns.push(`Onglet « ${sheetName} » : aucune colonne reconnue, ignoré.`); continue; }

        // Détenteur par défaut : le nom de l'onglet, s'il ne ressemble pas à
        // un nom générique (« Feuille 1 », « Sheet1 »…).
        const generique = /^(sheet|feuil)/i.test(sheetName.trim());
        const ouvrierOnglet = generique ? "" : sheetName.trim();

        for (let r = entete + 1; r < rows.length; r++) {
          const row = rows[r];
          const get = (champ) => (colonnes[champ] !== undefined ? row[colonnes[champ]] : "");
          const code = normCode(get("code"));
          const nom = String(get("nom") || "").trim();
          if (!code && !nom) continue; // ligne vide
          if (!code) { warns.push(`Onglet « ${sheetName} », ligne ${r + 1} : pas de code, ignorée (« ${nom} »).`); continue; }
          toutes.push({
            code,
            nom: nom || code,
            categorie: String(get("categorie") || "").trim(),
            ouvrier: String(get("ouvrier") || "").trim() || ouvrierOnglet,
            etat: mapEtatImport(get("etat")),
            date_remise: mapDateImport(get("date_remise")),
            notes: String(get("notes") || "").trim(),
          });
        }
      }

      // Doublons de code dans le fichier : la dernière ligne gagne.
      const parCode = new Map();
      let nbDoublons = 0;
      toutes.forEach((l) => { if (parCode.has(l.code)) nbDoublons++; parCode.set(l.code, l); });
      if (nbDoublons > 0) warns.push(`${nbDoublons} doublon${nbDoublons > 1 ? "s" : ""} de code dans le fichier : seule la dernière ligne de chaque code est retenue.`);
      const finales = [...parCode.values()];
      if (!finales.length) { setErreur("Aucune ligne exploitable trouvée dans ce fichier."); setLignes(null); return; }

      // Prénoms détectés absents du planning : proposer un rattachement.
      const inconnus = [...new Set(
        finales.map((l) => l.ouvrier).filter((o) => o && !ouvriersNorm.has(normalize(o)))
      )];
      const mapping = {};
      inconnus.forEach((o) => { mapping[o] = o; }); // par défaut : garder tel quel
      setMappingInconnus(mapping);
      setAvertissements(warns);
      setLignes(finales);
    } catch (e) {
      setErreur(`Impossible de lire ce fichier : ${e.message}`);
      setLignes(null);
    }
  };

  const resoudreOuvrier = (brut) => {
    if (!brut) return null;
    const exact = ouvriersNorm.get(normalize(brut));
    if (exact) return exact;
    const choix = mappingInconnus[brut];
    if (choix === "__depot__") return null;
    return choix || brut;
  };

  const stats = useMemo(() => {
    if (!lignes) return null;
    let nouveaux = 0, maj = 0;
    lignes.forEach((l) => { parCodeExistant.has(l.code) ? maj++ : nouveaux++; });
    return { nouveaux, maj };
  }, [lignes, parCodeExistant]);

  const importer = async () => {
    if (!lignes || enCours) return;
    setEnCours(true);
    setErreur("");
    const acteur = profil?.nom || profil?.email || null;
    const aInserer = [];
    const aMettreAJour = [];
    lignes.forEach((l) => {
      const ligne = {
        code: l.code,
        nom: l.nom,
        categorie: l.categorie || null,
        ouvrier_prenom: resoudreOuvrier(l.ouvrier),
        date_remise: l.date_remise,
        etat: l.etat,
        notes: l.notes || null,
        saisi_par: acteur,
      };
      const existant = parCodeExistant.get(l.code);
      if (existant) {
        if (mode === "upsert") aMettreAJour.push({ id: existant.id, ligne });
      } else {
        aInserer.push(ligne);
      }
    });

    // Insertions par paquets de 100.
    for (let i = 0; i < aInserer.length; i += 100) {
      const { error } = await supabase.from("materiel").insert(aInserer.slice(i, i + 100));
      if (error) { setErreur(`Erreur pendant l'insertion : ${error.message}`); setEnCours(false); return; }
    }
    for (const u of aMettreAJour) {
      const { error } = await supabase.from("materiel").update(u.ligne).eq("id", u.id);
      if (error) { setErreur(`Erreur pendant la mise à jour du code ${u.ligne.code} : ${error.message}`); setEnCours(false); return; }
    }
    setEnCours(false);
    setResultat({ inseres: aInserer.length, maj: aMettreAJour.length });
  };

  const champ = { display: "block", fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub, margin: "14px 0 4px" };
  const inconnusListe = Object.keys(mappingInconnus);

  return (
    <div
      onClick={onFermer}
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,14,20,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto",
          background: T.modal || T.surface, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.xl, padding: 20,
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.text, flex: 1 }}>
            Importer l'inventaire
          </h3>
          <button className="ib" title="Fermer" onClick={onFermer}><Icon as={X} size={15} /></button>
        </div>

        {resultat ? (
          <div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 14,
              color: "#22c55e", fontSize: FONT.sm.size + 1, fontWeight: 700,
            }}>
              <Icon as={CheckCircle2} size={18} color="#22c55e" />
              Import terminé : {resultat.inseres} outil{resultat.inseres > 1 ? "s" : ""} créé{resultat.inseres > 1 ? "s" : ""}, {resultat.maj} mis à jour.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button className="btn-p" onClick={onTermine}>Fermer</button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: "6px 0 0", fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.5 }}>
              Depuis Google Sheets : Fichier → Télécharger → Microsoft Excel (.xlsx), puis choisissez le fichier ici.
              Un onglet par ouvrier fonctionne (le nom de l'onglet sert de détenteur), tout comme une colonne « Ouvrier ».
            </p>

            <label style={champ}>Fichier (.xlsx, .xls ou .csv)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parserFichier(f); }}
              style={{ color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size }}
            />

            {erreur && (
              <div style={{ marginTop: 12, color: "#e05c5c", fontSize: FONT.sm.size, fontWeight: 600 }}>{erreur}</div>
            )}

            {lignes && (
              <>
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14,
                  fontSize: FONT.sm.size, color: T.text, fontWeight: 600,
                }}>
                  <span style={{ background: T.tagBg, color: T.tagColor, padding: "4px 10px", borderRadius: 99 }}>
                    {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
                  </span>
                  <span style={{ background: "#22c55e1f", color: "#22c55e", padding: "4px 10px", borderRadius: 99 }}>
                    {stats.nouveaux} nouveau{stats.nouveaux > 1 ? "x" : ""}
                  </span>
                  <span style={{ background: "#4db8ff1f", color: "#4db8ff", padding: "4px 10px", borderRadius: 99 }}>
                    {stats.maj} déjà connu{stats.maj > 1 ? "s" : ""}
                  </span>
                </div>

                {avertissements.length > 0 && (
                  <div style={{
                    marginTop: 10, padding: "8px 12px", borderRadius: RADIUS.md,
                    background: "#f59e0b14", border: "1px solid #f59e0b44",
                    fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.5,
                  }}>
                    {avertissements.slice(0, 6).map((w, i) => <div key={i}>• {w}</div>)}
                    {avertissements.length > 6 && <div>… et {avertissements.length - 6} autre{avertissements.length - 6 > 1 ? "s" : ""}.</div>}
                  </div>
                )}

                {inconnusListe.length > 0 && (
                  <>
                    <label style={champ}>Prénoms du fichier absents du planning — à rattacher :</label>
                    {inconnusListe.map((o) => (
                      <div key={o} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, flex: "0 0 130px" }}>{o}</span>
                        <select
                          className="ti"
                          value={mappingInconnus[o]}
                          onChange={(e) => setMappingInconnus((m) => ({ ...m, [o]: e.target.value }))}
                          style={{ flex: 1 }}>
                          <option value={o}>Garder « {o} » (hors planning)</option>
                          {ouvriers.map((p) => <option key={p} value={p}>{p}</option>)}
                          <option value="__depot__">Au dépôt (non affecté)</option>
                        </select>
                      </div>
                    ))}
                  </>
                )}

                {stats.maj > 0 && (
                  <>
                    <label style={champ}>Codes déjà présents dans l'inventaire</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setMode("upsert")} style={{
                        flex: 1, padding: "8px 6px", borderRadius: RADIUS.md, cursor: "pointer", fontFamily: "inherit",
                        fontSize: FONT.xs.size + 1, fontWeight: mode === "upsert" ? 800 : 600,
                        border: `1px solid ${mode === "upsert" ? acc.accent : T.border}`,
                        background: mode === "upsert" ? acc.bg10 : "transparent",
                        color: mode === "upsert" ? acc.accent : T.textSub,
                      }}>Mettre à jour avec le fichier</button>
                      <button onClick={() => setMode("nouveaux")} style={{
                        flex: 1, padding: "8px 6px", borderRadius: RADIUS.md, cursor: "pointer", fontFamily: "inherit",
                        fontSize: FONT.xs.size + 1, fontWeight: mode === "nouveaux" ? 800 : 600,
                        border: `1px solid ${mode === "nouveaux" ? acc.accent : T.border}`,
                        background: mode === "nouveaux" ? acc.bg10 : "transparent",
                        color: mode === "nouveaux" ? acc.accent : T.textSub,
                      }}>Ne pas y toucher</button>
                    </div>
                  </>
                )}

                {/* Aperçu des premières lignes */}
                <label style={champ}>Aperçu</label>
                <div style={{ overflowX: "auto", border: `1px solid ${T.sectionDivider}`, borderRadius: RADIUS.md }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.xs.size + 1 }}>
                    <thead>
                      <tr style={{ color: T.textMuted, textAlign: "left" }}>
                        {["Code", "Outil", "Ouvrier", "État"].map((h) => (
                          <th key={h} style={{ padding: "6px 10px", borderBottom: `1px solid ${T.sectionDivider}`, fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.slice(0, 8).map((l, i) => (
                        <tr key={i} style={{ color: T.text }}>
                          <td style={{ padding: "5px 10px", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 700 }}>{l.code}</td>
                          <td style={{ padding: "5px 10px" }}>{l.nom}</td>
                          <td style={{ padding: "5px 10px", color: T.textSub }}>{resoudreOuvrier(l.ouvrier) || "Au dépôt"}</td>
                          <td style={{ padding: "5px 10px", color: (ETATS[l.etat] || ETATS.bon).color, fontWeight: 700 }}>{(ETATS[l.etat] || ETATS.bon).label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lignes.length > 8 && (
                    <div style={{ padding: "5px 10px", fontSize: FONT.xs.size, color: T.textMuted }}>
                      … et {lignes.length - 8} autres lignes.
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                  <button className="btn-g" onClick={onFermer}>Annuler</button>
                  <button className="btn-p" onClick={importer} disabled={enCours}>
                    {enCours ? "Import en cours…" : `Importer ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}`}
                  </button>
                </div>
              </>
            )}
            {nomFichier && !lignes && !erreur && (
              <div style={{ marginTop: 12, fontSize: FONT.sm.size, color: T.textMuted }}>Lecture de {nomFichier}…</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
