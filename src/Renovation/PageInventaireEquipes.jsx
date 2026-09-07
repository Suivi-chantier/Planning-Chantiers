import React, { useMemo, useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { useIsMobile } from "../hooks";
import {
  Wrench, Search, X, Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  Warehouse, CalendarDays,
} from "lucide-react";

// États possibles d'un outil (colonne materiel.etat).
const ETATS = {
  bon: { label: "Bon état",     color: "#22c55e" },
  use: { label: "Usé",          color: "#f59e0b" },
  hs:  { label: "Hors service", color: "#e05c5c" },
};

// Clé de sélection du bucket « matériel non affecté » (au dépôt).
const DEPOT = "__depot__";

const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const dateFR = (iso) => {
  const d = iso ? new Date(iso + "T00:00:00") : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
};

// Inventaire des équipes : qui détient quel matériel.
// Colonne de gauche = les ouvriers (prénoms du planning) + le dépôt ;
// clic sur un ouvrier = la liste des outils à sa disposition, avec le code
// unique inscrit sur chaque outil mis en évidence.
export default function PageInventaireEquipes({ T, branch = "renovation", ouvriers = [], profil = null }) {
  const acc = getBranchAccent(branch);
  const isMobile = useIsMobile();

  const [items, setItems] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [selection, setSelection] = useState(null); // prénom | DEPOT | null
  const [recherche, setRecherche] = useState("");
  const [modal, setModal] = useState(null); // { item } — item.id absent = création

  const charger = useCallback(async () => {
    const { data, error } = await supabase
      .from("materiel")
      .select("*")
      .order("nom", { ascending: true });
    if (error) { setErreur(error.message); setChargement(false); return; }
    setItems(data || []);
    setErreur("");
    setChargement(false);
  }, []);
  useEffect(() => { charger(); }, [charger]);

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

  const LigneMateriel = ({ item, montrerDetenteur = false }) => {
    const etat = ETATS[item.etat] || ETATS.bon;
    return (
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg,
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
            <span style={{
              fontSize: FONT.xs.size, fontWeight: 700, color: etat.color, background: `${etat.color}1f`,
              padding: "2px 8px", borderRadius: 99,
            }}>{etat.label}</span>
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
  };

  const CarteDetenteur = ({ prenom, nb, ancien = false, depot = false }) => {
    const actif = selection === (depot ? DEPOT : prenom);
    const initiales = depot ? null : prenom.slice(0, 2).toUpperCase();
    return (
      <button
        onClick={() => setSelection(depot ? DEPOT : prenom)}
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
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {nb} outil{nb > 1 ? "s" : ""}
          </div>
        </div>
        <Icon as={ChevronRight} size={15} color={actif ? acc.accent : T.textMuted} />
      </button>
    );
  };

  // ── Panneaux ──
  const panneauListe = (
    <div style={{ flex: isMobile ? 1 : "0 0 290px", minWidth: 0 }}>
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

  const panneauDetail = (
    <div style={{ flex: 1, minWidth: 0 }}>
      {selection ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
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
            <button className="btn-p" onClick={() => setModal({ item: { ouvrier_prenom: selection === DEPOT ? "" : selection } })}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon as={Plus} size={14} /> Ajouter du matériel
            </button>
          </div>
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
        </>
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
              ? "La table « materiel » n'existe pas encore : lancez la migration sql/202609_inventaire_equipes.sql dans Supabase."
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
    etat: item.etat || "bon",
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
        <div style={{ display: "flex", gap: 6 }}>
          {Object.entries(ETATS).map(([id, e]) => {
            const actif = form.etat === id;
            return (
              <button key={id} onClick={() => setForm((f) => ({ ...f, etat: id }))} style={{
                flex: 1, padding: "8px 4px", borderRadius: RADIUS.md, cursor: "pointer",
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
