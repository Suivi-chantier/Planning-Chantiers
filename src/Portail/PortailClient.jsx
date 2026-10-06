// src/Portail/PortailClient.jsx — Espace client Profero Invest (/espace-client).
//
// L'écran ne lit QUE les vues portail_* (jamais une table de base) ; la seule écriture est la saisie du client
// (MonDossier.jsx), qui passe par des fonctions de la base et arrive en attente de validation. Il ne charge aucun module du bureau : le client ne reçoit pas le
// code de l'application collaborateurs. La protection réelle est en base (vues
// filtrées sur le client de la connexion, règle « collaborateurs seulement » sur
// les tables, lien signé de 60 s pour les documents) ; cet écran ne fait que l'afficher.
//
// Une erreur de chargement n'est JAMAIS présentée comme « rien à afficher ».
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import MonDossier from "./MonDossier";
import MesPieces from "./MesPieces";
import {
  POPULATION_CLIENT, populationDuJeton, bonjour, etapesTriees, tachesClient, etatSection,
  dateFr, LETTRE, STATUT_DOSSIER, lireLienInvitation, validerMotDePasse,
} from "./portailVue";

const LOGO = "/logos/profero-invest-h.png";
const C = { fond: "#f7f1e5", carte: "#ffffff", texte: "#111827", doux: "#667085", bord: "rgba(15,23,42,.12)", marine: "#071426", or: "#d6a84c", orFonce: "#b8872c",
  vert: "#16a34a", bleu: "#2563eb", ambre: "#b45309", rouge: "#b91c1c" };
const TON = { fait: C.vert, actif: C.bleu, attente: C.ambre, neutre: C.doux };
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const CSS = `
  html,body{margin:0}
  .pc-racine{min-height:100vh;background:${C.fond};color:${C.texte};font-family:'Barlow',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-text-size-adjust:100%}
  .pc-racine *{box-sizing:border-box}
  .pc-entete{background:#fff;color:${C.texte};border-bottom:3px solid ${C.or}}
  .pc-entete-in{max-width:960px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
  .pc-main{max-width:960px;margin:0 auto;padding:20px 16px 48px;display:flex;flex-direction:column;gap:16px}
  .pc-carte{background:${C.carte};border:1px solid ${C.bord};border-radius:16px;padding:16px 18px}
  .pc-h2{margin:0 0 10px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${C.doux}}
  .pc-btn{font:inherit;font-weight:700;font-size:14px;border-radius:10px;border:1px solid ${C.bord};background:#fff;color:${C.texte};padding:9px 14px;cursor:pointer;min-height:40px}
  .pc-btn:disabled{opacity:.6;cursor:default}
  .pc-btn-or{background:linear-gradient(135deg,#fff0c8,${C.or});border-color:${C.or};color:${C.marine}}
  .pc-input{font:inherit;font-size:16px;width:100%;padding:11px 12px;border:1px solid ${C.bord};border-radius:10px;background:#fff;color:${C.texte}}
  .pc-ligne{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-top:1px solid ${C.bord}}
  .pc-ligne:first-of-type{border-top:0}
  .pc-pastille{display:inline-block;font-size:12px;font-weight:800;border-radius:999px;padding:2px 9px;white-space:nowrap}
  .pc-etapes{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
  @media (max-width:520px){.pc-ligne{flex-direction:column;align-items:flex-start;gap:6px}}
`;
const Pastille = ({ ton, children }) => (
  <span className="pc-pastille" style={{ color: TON[ton] || C.doux, background: `${TON[ton] || C.doux}14`, border: `1px solid ${TON[ton] || C.doux}35` }}>{children}</span>
);
const Carte = ({ titre, children }) => <section className="pc-carte"><h2 className="pc-h2">{titre}</h2>{children}</section>;
const Erreur = ({ children }) => <div role="alert" style={{ color: C.rouge, fontSize: 14 }}>{children}</div>;
const Info = ({ children }) => <div style={{ color: C.doux, fontSize: 14 }}>{children}</div>;

function Cadre({ children, onDeconnexion }) {
  return (
    <div className="pc-racine">
      <style>{CSS}</style>
      <header className="pc-entete"><div className="pc-entete-in">
        <img src={LOGO} alt="Profero Invest" style={{ height: 34, objectFit: "contain" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
          <span style={{ color: C.marine, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>Espace client</span>
          {onDeconnexion && <button className="pc-btn" onClick={onDeconnexion} style={{ minHeight: 34, padding: "5px 11px", fontSize: 13 }}>Se déconnecter</button>}
        </div>
      </div></header>
      {children}
    </div>
  );
}

function Connexion({ onConnecte }) {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const valider = async (ev) => {
    ev.preventDefault();
    if (!email.trim() || !mdp) { setErreur("Renseignez votre adresse e-mail et votre mot de passe."); return; }
    setEnvoi(true); setErreur("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: mdp });
    setEnvoi(false);
    if (error) {
      setErreur(/Accès Profero refusé/.test(error.message || "")
        ? "Votre accès n'est pas (ou plus) autorisé. Contactez votre conseiller Profero."
        : "Adresse e-mail ou mot de passe incorrect.");
      return;
    }
    onConnecte(data.session);
  };
  return (
    <main className="pc-main" style={{ maxWidth: 440 }}>
      <form className="pc-carte" onSubmit={valider} noValidate>
        <h1 style={{ margin: "0 0 4px", fontSize: 24 }}>Connexion</h1>
        <p style={{ margin: "0 0 16px", color: C.doux, fontSize: 14 }}>Suivez l'avancement de votre accompagnement.</p>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }} htmlFor="pc-email">Adresse e-mail</label>
        <input id="pc-email" className="pc-input" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, margin: "14px 0 6px" }} htmlFor="pc-mdp">Mot de passe</label>
        <input id="pc-mdp" className="pc-input" type="password" autoComplete="current-password" value={mdp} onChange={(e) => setMdp(e.target.value)} />
        {erreur && <div style={{ marginTop: 12 }}><Erreur>{erreur}</Erreur></div>}
        <button className="pc-btn pc-btn-or" type="submit" disabled={envoi} style={{ width: "100%", marginTop: 16 }}>{envoi ? "Connexion…" : "Se connecter"}</button>
        <p style={{ margin: "14px 0 0", color: C.doux, fontSize: 13 }}>Mot de passe oublié ou problème d'accès ? Contactez votre conseiller Profero : il vous enverra un nouveau lien.</p>
      </form>
    </main>
  );
}

function ChoixMotDePasse({ onTermine }) {
  const [mdp, setMdp] = useState("");
  const [conf, setConf] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const valider = async (ev) => {
    ev.preventDefault();
    const probleme = validerMotDePasse(mdp, conf);
    if (probleme) { setErreur(probleme); return; }
    setEnvoi(true); setErreur("");
    const { error } = await supabase.auth.updateUser({ password: mdp });
    if (error) { setEnvoi(false); setErreur("Votre mot de passe n'a pas pu être enregistré. Réessayez ou demandez un nouveau lien à votre conseiller."); return; }
    const { data } = await supabase.auth.getSession();
    onTermine(data.session);
  };
  return (
    <main className="pc-main" style={{ maxWidth: 440 }}>
      <form className="pc-carte" onSubmit={valider} noValidate>
        <h1 style={{ margin: "0 0 4px", fontSize: 24 }}>Choisissez votre mot de passe</h1>
        <p style={{ margin: "0 0 16px", color: C.doux, fontSize: 14 }}>Il vous servira à vous reconnecter à votre espace client.</p>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 }} htmlFor="pc-nmdp">Nouveau mot de passe (8 caractères minimum)</label>
        <input id="pc-nmdp" className="pc-input" type="password" autoComplete="new-password" value={mdp} onChange={(e) => setMdp(e.target.value)} />
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, margin: "14px 0 6px" }} htmlFor="pc-cmdp">Confirmez le mot de passe</label>
        <input id="pc-cmdp" className="pc-input" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
        {erreur && <div style={{ marginTop: 12 }}><Erreur>{erreur}</Erreur></div>}
        <button className="pc-btn pc-btn-or" type="submit" disabled={envoi} style={{ width: "100%", marginTop: 16 }}>{envoi ? "Enregistrement…" : "Enregistrer et accéder à mon espace"}</button>
      </form>
    </main>
  );
}

function Telechargement({ doc }) {
  const [etat, setEtat] = useState("");
  const telecharger = async () => {
    setEtat("…");
    const fenetre = window.open("", "_blank"); // ouverte tout de suite : évite le blocage des fenêtres
    const { data, error } = await supabase.functions.invoke("portail-document-url", { body: { documentId: doc.id } });
    if (error || !data?.ok || !data.url) {
      fenetre?.close();
      setEtat("Téléchargement indisponible pour le moment. Réessayez ou contactez votre conseiller.");
      return;
    }
    setEtat("");
    if (fenetre) { fenetre.opener = null; fenetre.location.href = data.url; } else { window.location.href = data.url; }
  };
  return (
    <div className="pc-ligne">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{doc.libelle}</div>
        <div style={{ color: C.doux, fontSize: 13 }}>Partagé le {dateFr(doc.partage_le)}</div>
        {etat && etat !== "…" && <Erreur>{etat}</Erreur>}
      </div>
      <button className="pc-btn" onClick={telecharger} disabled={etat === "…"} aria-label={`Télécharger ${doc.libelle}`}>{etat === "…" ? "Ouverture…" : "Télécharger"}</button>
    </div>
  );
}

function Espace() {
  const [donnees, setDonnees] = useState(null);
  const charger = useCallback(async () => {
    const lire = (v, colonnes) => supabase.from(v).select(colonnes);
    const [cl, dos, et, ta, dc, ev] = await Promise.all([
      lire("portail_client", "prenom,nom,telephone"),
      lire("portail_dossier", "id,reference,libelle,statut,date_ouverture,lettre_mission_statut,lettre_mission_signee_le"),
      lire("portail_etapes", "id,dossier_id,etape,statut,date_debut,date_fin"),
      lire("portail_taches", "id,dossier_id,step_label,action_title,status,due_date,completed_at"),
      lire("portail_documents", "id,dossier_id,libelle,partage_le").order("partage_le", { ascending: false }),
      lire("portail_evenements", "id,dossier_id,type,resume,survenu_le").order("survenu_le", { ascending: false }).limit(10),
    ]);
    setDonnees({ client: cl.data?.[0] ?? null, dossiers: etatSection(dos), etapes: etatSection(et), taches: etatSection(ta), documents: etatSection(dc), evenements: etatSection(ev) });
  }, []);
  useEffect(() => { charger(); }, [charger]);

  if (!donnees) return <main className="pc-main"><Info>Chargement de votre espace…</Info></main>;
  const { dossiers, etapes, taches, documents, evenements } = donnees;
  const t = tachesClient(taches.lignes, aujourdhui());
  return (
    <main className="pc-main">
      <div>
        <h1 style={{ margin: 0, fontSize: 28 }}>{bonjour(donnees.client)}</h1>
        <p style={{ margin: "4px 0 0", color: C.doux }}>Voici l'avancement de votre accompagnement.</p>
      </div>

      {dossiers.etat === "erreur" && <Carte titre="Votre dossier"><Erreur>Impossible d'afficher votre dossier pour le moment. Réessayez plus tard ou contactez votre conseiller.</Erreur></Carte>}
      {dossiers.etat === "vide" && <Carte titre="Votre dossier"><Info>Aucun dossier n'est partagé pour le moment. Votre conseiller vous le présentera ici dès qu'il sera prêt.</Info></Carte>}
      {dossiers.lignes.map((d) => (
        <Carte key={d.id} titre={`Votre dossier ${d.reference || ""}`.trim()}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 12 }}>
            <strong style={{ fontSize: 18 }}>{d.libelle || "Accompagnement Profero Invest"}</strong>
            <Pastille ton={d.statut === "clos" ? "fait" : d.statut === "suspendu" ? "attente" : "actif"}>{STATUT_DOSSIER[d.statut] || d.statut}</Pastille>
          </div>
          <div style={{ color: C.doux, fontSize: 14, marginBottom: 12 }}>
            {d.date_ouverture && <>Ouvert le {dateFr(d.date_ouverture)}</>}
            {LETTRE[d.lettre_mission_statut] && <> · Lettre de mission : {LETTRE[d.lettre_mission_statut].toLowerCase()}{d.lettre_mission_signee_le && d.lettre_mission_statut === "signee" ? ` le ${dateFr(d.lettre_mission_signee_le)}` : ""}</>}
          </div>
          {etapes.etat === "erreur"
            ? <Erreur>Impossible d'afficher les étapes pour le moment.</Erreur>
            : <div className="pc-etapes">{etapesTriees(etapes.lignes.filter((e) => e.dossier_id === d.id)).map((e) => (
                <div key={e.id} style={{ border: `1px solid ${C.bord}`, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{e.titre}</div>
                  <Pastille ton={e.ton}>{e.statut}</Pastille>
                </div>))}</div>}
        </Carte>
      ))}

      <Carte titre="Mes informations"><MonDossier telephoneActuel={donnees.client?.telephone || ""} /></Carte>

      <Carte titre="Pièces à nous transmettre"><MesPieces /></Carte>

      <Carte titre="Ce qui vous concerne">
        {taches.etat === "erreur" ? <Erreur>Impossible d'afficher vos tâches pour le moment.</Erreur>
          : taches.etat === "vide" ? <Info>Rien à faire de votre côté pour le moment.</Info>
          : <>
              {t.aFaire.length === 0 && <Info>Rien à faire de votre côté pour le moment.</Info>}
              {t.aFaire.map((x) => (
                <div className="pc-ligne" key={x.id}>
                  <div><div style={{ fontWeight: 700 }}>{x.titre}</div>{x.etape && <div style={{ color: C.doux, fontSize: 13 }}>{x.etape}</div>}</div>
                  <div style={{ whiteSpace: "nowrap", fontSize: 13, color: x.enRetard ? C.rouge : C.doux }}>{x.echeance ? `${x.enRetard ? "À faire depuis le " : "Pour le "}${dateFr(x.echeance)}` : "À faire"}</div>
                </div>))}
              {t.terminees.length > 0 && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", color: C.doux, fontSize: 14 }}>Terminées ({t.terminees.length})</summary>
                {t.terminees.map((x) => <div className="pc-ligne" key={x.id}><div>{x.titre}</div><Pastille ton="fait">Terminée</Pastille></div>)}</details>}
            </>}
      </Carte>

      <Carte titre="Vos documents">
        {documents.etat === "erreur" ? <Erreur>Impossible d'afficher vos documents pour le moment.</Erreur>
          : documents.etat === "vide" ? <Info>Aucun document n'est partagé pour le moment.</Info>
          : documents.lignes.map((doc) => <Telechargement key={doc.id} doc={doc} />)}
      </Carte>

      <Carte titre="Dernières nouvelles">
        {evenements.etat === "erreur" ? <Erreur>Impossible d'afficher les dernières nouvelles pour le moment.</Erreur>
          : evenements.etat === "vide" ? <Info>Aucune nouvelle pour le moment.</Info>
          : evenements.lignes.map((e) => <div className="pc-ligne" key={e.id}><div>{e.resume}</div><div style={{ color: C.doux, fontSize: 13, whiteSpace: "nowrap" }}>{dateFr(e.survenu_le)}</div></div>)}
      </Carte>
    </main>
  );
}

export default function PortailClient() {
  const [phase, setPhase] = useState("chargement"); // chargement | connexion | refuse | espace | motdepasse | lieninvalide
  useEffect(() => { document.title = "Espace client · Profero Invest"; }, []);
  // Le lien est lu UNE fois (état initial) et validé UNE fois (le jeton est à usage unique,
  // même si React rejoue l'effet en développement).
  const [lienInitial] = useState(() => lireLienInvitation(window.location.search));
  const lienTraite = useRef(false);

  const decider = useCallback((session) => {
    if (!session) { setPhase("connexion"); return; }
    setPhase(populationDuJeton(session.access_token) === POPULATION_CLIENT ? "espace" : "refuse");
  }, []);

  useEffect(() => {
    // Lien reçu par courriel (?token_hash=…&type=invite|recovery) : retiré de l'adresse AVANT
    // toute vérification (à usage unique, jamais gardé dans l'historique du navigateur), puis
    // validé par Supabase. Le hook d'accès refuse tout compte qui n'est pas un client lié.
    if (lienInitial) {
      if (!lienTraite.current) {
        lienTraite.current = true;
        window.history.replaceState({}, "", window.location.pathname);
        supabase.auth.verifyOtp({ token_hash: lienInitial.tokenHash, type: lienInitial.type }).then(({ data, error }) => {
          if (error || !data?.session) { setPhase("lieninvalide"); return; }
          setPhase(populationDuJeton(data.session.access_token) === POPULATION_CLIENT ? "motdepasse" : "refuse");
        });
      }
    } else {
      supabase.auth.getSession().then(({ data }) => decider(data.session));
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") setPhase("connexion"); });
    return () => subscription.unsubscribe();
  }, [decider, lienInitial]);

  const deconnexion = async () => { await supabase.auth.signOut(); setPhase("connexion"); };

  if (phase === "chargement") return <Cadre><main className="pc-main"><Info>Chargement…</Info></main></Cadre>;
  if (phase === "connexion") return <Cadre><Connexion onConnecte={decider} /></Cadre>;
  if (phase === "motdepasse") return <Cadre><ChoixMotDePasse onTermine={decider} /></Cadre>;
  if (phase === "lieninvalide") {
    return (
      <Cadre>
        <main className="pc-main" style={{ maxWidth: 520 }}>
          <Carte titre="Lien non valide">
            <p style={{ margin: "0 0 14px" }}>Ce lien n'est plus valide : il a peut-être déjà été utilisé ou a expiré. Contactez votre conseiller Profero, qui vous enverra un nouveau lien.</p>
            <button className="pc-btn pc-btn-or" onClick={() => setPhase("connexion")}>Aller à la connexion</button>
          </Carte>
        </main>
      </Cadre>
    );
  }
  if (phase === "refuse") {
    return (
      <Cadre>
        <main className="pc-main" style={{ maxWidth: 520 }}>
          <Carte titre="Accès non autorisé">
            <p style={{ margin: "0 0 14px" }}>Cet espace est réservé aux clients de Profero Invest. Vous êtes connecté avec un autre type de compte.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="pc-btn pc-btn-or" href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Retour à l'application Profero</a>
            </div>
          </Carte>
        </main>
      </Cadre>
    );
  }
  return <Cadre onDeconnexion={deconnexion}><Espace /></Cadre>;
}
