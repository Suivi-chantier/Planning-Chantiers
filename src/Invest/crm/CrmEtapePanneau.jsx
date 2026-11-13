// src/Invest/crm/CrmEtapePanneau.jsx — Panneau d'une étape ouvert depuis le tableau « Avancement ».
//
// Réutilise PanneauEtape (le même que la fiche Dossier) : statut par gestes, commentaire daté,
// prochaine action, échéance, tâches de l'étape, journal. Seul ajout : un bloc « Dates » (début /
// validation) et le dernier intervenant. Les changements de statut passent par preparerGeste
// (mêmes règles que la base) ; seule cette page écrit des dates, dans date_debut / date_fin.
// Aucune écriture ailleurs : le CRM (CrmV2, CrmSynthese, CrmAvancement) reste en lecture seule.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { PanneauEtape } from "../dossiers/DossierInvestCard";
import { tachesParEtape, journal as journalVue } from "../dossiers/dossierVue";
import { dateCourte, aujourdhuiIso } from "./ui";

function BlocDates({ T, etape, clos, intervenant, onEnregistre }) {
  const [debut, setDebut] = useState(String(etape.date_debut || "").slice(0, 10));
  const [fin, setFin] = useState(String(etape.date_fin || "").slice(0, 10));
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { setDebut(String(etape.date_debut || "").slice(0, 10)); setFin(String(etape.date_fin || "").slice(0, 10)); setErreur(""); }, [etape.id, etape.date_debut, etape.date_fin]);
  const change = debut !== String(etape.date_debut || "").slice(0, 10) || fin !== String(etape.date_fin || "").slice(0, 10);
  const enregistrer = async () => {
    if (debut && fin && fin < debut) { setErreur("La date de validation ne peut pas précéder la date de début."); return; }
    setEnCours(true); setErreur("");
    const { data, error } = await supabase.from("invest_dossier_etapes").update({ date_debut: debut || null, date_fin: fin || null }).eq("id", etape.id).select("id");
    setEnCours(false);
    if (error || !data?.length) { setErreur(error ? error.message : "Modification refusée (droits insuffisants ou étape introuvable)."); return; }
    onEnregistre("Dates de l'étape enregistrées.");
  };
  return (
    <div style={{ border: `1px solid ${T.border}`, background: T.input, borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 900, textTransform: "uppercase", letterSpacing: .8, marginBottom: 6 }}>Dates</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ fontSize: 12, color: T.textMuted }}>Début
          <input className="inv-inp" type="date" value={debut} disabled={clos} onChange={(e) => setDebut(e.target.value)} style={{ width: "100%", textAlign: "left" }} />
        </label>
        <label style={{ fontSize: 12, color: T.textMuted }}>Validation
          <input className="inv-inp" type="date" value={fin} disabled={clos} onChange={(e) => setFin(e.target.value)} style={{ width: "100%", textAlign: "left" }} />
        </label>
      </div>
      {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
      {!clos && change && <button className="inv-btn inv-btn-blue inv-btn-sm" style={{ marginTop: 8 }} onClick={enregistrer} disabled={enCours}>Enregistrer les dates</button>}
      <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>
        Dernière modification : <b style={{ color: T.text }}>{intervenant.nom || "intervenant non enregistré"}</b>{intervenant.quand ? ` · ${dateCourte(intervenant.quand)}` : ""}
      </div>
    </div>
  );
}

export default function CrmEtapePanneau({ T, ligne, cellule, utilisateurs = [], taches = [], profil, onFermer, onChange }) {
  const [etape, setEtape] = useState(null);
  const [evenements, setEvenements] = useState([]);
  const [erreur, setErreur] = useState("");
  const aujourdhui = aujourdhuiIso();

  const charger = useCallback(async () => {
    setErreur("");
    const [re, rv] = await Promise.all([
      supabase.from("invest_dossier_etapes").select("*").eq("id", cellule.id).single(),
      supabase.from("invest_dossier_evenements").select("id,ordre,survenu_le,type,resume,auteur_libelle,auteur_type,etape_id,dossier_id")
        .eq("etape_id", cellule.id).order("survenu_le", { ascending: false }).order("ordre", { ascending: false }).limit(100),
    ]);
    if (re.error) { setErreur(`Étape illisible : ${re.error.message}`); return; }
    setEtape(re.data);
    setEvenements(rv.data || []);
    if (rv.error) setErreur(`Journal incomplet : ${rv.error.message}`);
  }, [cellule.id]);
  useEffect(() => { setEtape(null); charger(); }, [charger]);

  const monId = useMemo(() => utilisateurs.find((u) => String(u.email || "").trim().toLowerCase() === String(profil?.email || "").trim().toLowerCase())?.id || "", [utilisateurs, profil]);
  const tachesEtape = useMemo(() => tachesParEtape(taches, ligne.dossierId)[cellule.etape] ?? { ouvertes: [], faites: [], autres: [] }, [taches, ligne.dossierId, cellule.etape]);
  const apres = (message) => { charger(); onChange?.(message); };

  if (erreur && !etape) {
    return (
      <div role="dialog" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end", background: "rgba(15,23,42,.25)" }} onClick={onFermer}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px,100%)", background: T.surface || "#fff", color: T.text, padding: 16 }}>
          <div style={{ color: "#be123c", fontSize: 13 }}>{erreur}</div>
          <button className="inv-btn inv-btn-sm" style={{ marginTop: 10 }} onClick={onFermer}>Fermer</button>
        </div>
      </div>
    );
  }
  if (!etape) return null;
  const clos = !ligne.enCours;
  const intervenant = { nom: utilisateurs.find((u) => u.id === etape.modifie_par_id)?.nom ?? null, quand: etape.updated_at };
  return (
    <PanneauEtape T={T} cle={cellule.etape} dossier={{ id: ligne.dossierId, reference: ligne.reference }} clos={clos} etape={etape}
      taches={tachesEtape} utilisateurs={utilisateurs} monId={monId} journal={journalVue(evenements, etape.id)} aujourdhui={aujourdhui}
      onFermer={onFermer} onEnregistre={apres}
      extra={<BlocDates T={T} etape={etape} clos={clos} intervenant={intervenant} onEnregistre={apres} />} />
  );
}
