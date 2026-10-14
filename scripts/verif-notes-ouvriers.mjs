#!/usr/bin/env node
// Vérifie les « Notes des ouvriers » :
//   - src/Renovation/notesOuvriers.mjs (module pur : partage, liste à cocher,
//     validation, lu / non lu, classement ouvrier, filtres et tri bureau) ;
//   - supabase/migrations/20261014120000_notes_ouvriers.sql, exécutée dans un
//     vrai PostgreSQL (PGlite, en mémoire) sur une réplique MINIMALE :
//     utilisateurs, helpers de rôle de production (mon_role, est_ouvrier,
//     mon_prenom_planning), est_collaborateur_actif, norm_prenom, et un schéma
//     storage réduit (buckets, objects, foldername).
//
// DONNÉES : toutes FICTIVES, écrites ici (ouvriers Paul, Marc, Hugo, Inès ;
// conducteur « Claire Bureau » ; chantier « ch1 »). Aucune donnée réelle.
//
// Contrôles principaux :
//   1. une note PRIVÉE n'est lue par personne d'autre que son auteur — ni un
//      collègue, ni le bureau, ni un admin ; idem pour ses photos ;
//   2. partage : collègue nommé (casse/accents/espaces), bureau, mémo chantier
//      (tous les ouvriers + bureau) ; jamais soi-même, sans doublon ;
//   3. l'auteur est imposé par la base (impossible d'écrire au nom d'un autre) ;
//      seul l'auteur modifie / supprime ; le bureau ne crée rien et ne change
//      que le suivi ; cocher une case ne relance pas le suivi, modifier oui ;
//   4. réponses : réservées à ceux qui voient la note, auteur et côté imposés,
//      la note remonte et redevient « nouveau » quand un ouvrier répond ;
//   5. comptes inactifs, inconnus, anonymes : rien ;
//   6. migration rejouable, aucune policy / table existante modifiée.
//
//   npm install --no-save --no-package-lock @electric-sql/pglite@0.5.8   (une fois)
//   node scripts/verif-notes-ouvriers.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  normaliserPrenom, normaliserDestinataires, estPrivee, libellePartage, listeFr, nettoyerChecklist,
  ajouterElement, basculerElement, retirerElement, progressionChecklist, brouillonVide, brouillonDepuisNote,
  problemesNote, ligneDepuisBrouillon, titreAffiche, estNonLue, classerNotesOuvrier, memosDuChantier,
  filtrerNotesBureau, trierNotesBureau, compteursBureau, libelleSuivi, cheminPhoto, estATraiter, typeNote,
} from "../src/Renovation/notesOuvriers.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION = readFileSync(join(racine, "supabase/migrations/20261014120000_notes_ouvriers.sql"), "utf8");
const ROLLBACK = readFileSync(join(racine, "sql/202610_notes_ouvriers_rollback.sql"), "utf8");

let nbOk = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); nbOk++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); nbOk++; };

// ═══ 1. Module pur ═══════════════════════════════════════════════════════════
eq(normaliserPrenom("  Inès   Marie "), "ines marie", "normalisation : accents, casse, espaces");
eq(normaliserDestinataires(["Marc", " marc ", "Paul", "", "Hugo", "Hugo"], "paul"), ["Hugo", "Marc"],
  "destinataires : dédoublonnés, sans soi-même, triés");
eq(listeFr(["Paul"]), "Paul", "liste : un nom");
eq(listeFr(["Paul", "Marc", "le bureau"]), "Paul, Marc et le bureau", "liste : virgules puis « et »");

const privee = { partage_ouvriers: [], partage_bureau: false, memo_chantier: false };
ok(estPrivee(privee), "sans partage = privée");
eq(libellePartage(privee), "Privée : visible par toi seul", "libellé privé (auteur)");
eq(libellePartage(privee, { pourAuteur: false }), "Privée", "libellé privé (autre lecteur)");
eq(libellePartage({ partage_ouvriers: ["Marc"], partage_bureau: true }), "Partagée avec Marc et le bureau", "libellé partagé");
eq(libellePartage({ memo_chantier: true, partage_ouvriers: ["Marc"] }), "Mémo chantier : visible par tous les ouvriers et le bureau",
  "un mémo prime sur le reste du partage");
ok(!estPrivee({ partage_ouvriers: ["Marc"] }) && !estPrivee({ partage_bureau: true }) && !estPrivee({ memo_chantier: true }),
  "collègue, bureau ou mémo : plus privée");

let cl = ajouterElement([], "  perforateur ", "a");
cl = ajouterElement(cl, "   ", "b");
cl = ajouterElement(cl, "chevilles", "c");
eq(cl.map(e => e.texte), ["perforateur", "chevilles"], "liste : texte vide ignoré, texte rogné");
cl = basculerElement(cl, "a");
eq(progressionChecklist(cl), { faits: 1, total: 2 }, "liste : progression");
eq(retirerElement(cl, "c").length, 1, "liste : retrait");
eq(nettoyerChecklist([{ id: "x", texte: "" }, { texte: "sans id" }, { id: "y", texte: " ok ", fait: "oui" }]),
  [{ id: "y", texte: "ok", fait: false }], "liste : éléments invalides écartés, fait strictement booléen");

eq(problemesNote(brouillonVide()).length, 1, "brouillon vide : bloqué");
eq(problemesNote({ ...brouillonVide(), photos: ["u/p.jpg"] }), [], "une photo seule suffit");
eq(problemesNote({ ...brouillonVide(), titre: "Digicode", memo_chantier: true }), ["Choisis le chantier du mémo."], "mémo sans chantier : bloqué");
ok(problemesNote({ ...brouillonVide(), titre: "x", photos: Array(11).fill("p") }).some(p => /10 photos/.test(p)), "11 photos : bloqué");
eq(brouillonVide({ chantierId: "ch1", memo: true }).memo_chantier, true, "nouveau mémo pré-rempli depuis un chantier");
eq(brouillonVide({ memo: true }).memo_chantier, false, "mémo impossible sans chantier");

const ligne = ligneDepuisBrouillon({
  type: "inconnu", titre: "  Titre ", contenu: "texte  \n", checklist: [{ id: "a", texte: "x" }, { id: "", texte: "y" }],
  photos: ["a.jpg", null], chantier_id: "", memo_chantier: true, partage_bureau: 1, partage_ouvriers: ["Paul", "Marc"],
}, "Paul");
eq(ligne, {
  type: "note", titre: "Titre", contenu: "texte", checklist: [{ id: "a", texte: "x", fait: false }], photos: ["a.jpg"],
  chantier_id: null, memo_chantier: false, partage_bureau: true, partage_ouvriers: ["Marc"],
}, "ligne écrite : type connu, textes rognés, mémo sans chantier refusé, sans soi-même");
ok(!("auteur" in ligne) && !("statut_bureau" in ligne), "la ligne n'envoie ni auteur ni suivi (posés par la base)");
eq(brouillonDepuisNote({ type: "signaler", titre: "t", photos: ["a", 3], partage_ouvriers: ["Marc"] }).photos, ["a"], "brouillon depuis une note");

eq(titreAffiche({ titre: " ", contenu: "\n  Fuite sous évier \nsuite" }), "Fuite sous évier", "titre : 1re ligne du texte");
eq(titreAffiche({ checklist: [{ id: "a", texte: "x" }, { id: "b", texte: "y" }] }), "Liste (2 éléments)", "titre : liste");
eq(titreAffiche({ photos: ["p"] }), "Photo", "titre : photo seule");
eq(typeNote("nimporte").id, "note", "type inconnu → note");

const P = "uid-paul", M = "uid-marc";
const n1 = { id: "n1", auteur_uid: P, derniere_activite: "2026-10-14T10:00:00Z", derniere_activite_par: P };
const n2 = { id: "n2", auteur_uid: M, derniere_activite: "2026-10-14T11:00:00Z", derniere_activite_par: M };
const n3 = { id: "n3", auteur_uid: P, derniere_activite: "2026-10-14T12:00:00Z", derniere_activite_par: M };
ok(!estNonLue(n1, {}, P), "ma propre activité n'est jamais « non lue »");
ok(estNonLue(n2, {}, P), "note d'un collègue jamais ouverte : non lue");
ok(!estNonLue(n2, { n2: "2026-10-14T11:30:00Z" }, P), "ouverte après l'activité : lue");
ok(estNonLue(n3, { n3: "2026-10-14T11:30:00Z" }, P), "réponse d'un collègue après ma lecture : non lue");
ok(!estNonLue(n2, {}, null), "sans identité : rien n'est signalé");

const memo = { id: "m1", auteur_uid: M, memo_chantier: true, chantier_id: "ch1", derniere_activite: "2026-10-14T09:00:00Z" };
const memoP = { id: "m2", auteur_uid: P, memo_chantier: true, chantier_id: "ch2", derniere_activite: "2026-10-14T13:00:00Z" };
const c = classerNotesOuvrier([n1, n2, n3, memo, memoP], P);
eq(c.miennes.map(n => n.id), ["m2", "n3", "n1"], "mes notes (dont mes mémos), plus récentes d'abord");
eq(c.recues.map(n => n.id), ["n2"], "reçues : d'un collègue, hors mémos");
eq(c.memos.map(n => n.id), ["m2", "m1"], "mémos : tous");
eq(memosDuChantier([n1, memo, memoP], "ch1").map(n => n.id), ["m1"], "mémos d'un chantier");
eq(memosDuChantier([memo], ""), [], "pas de chantier : pas de mémo");

const B = [
  { id: "a", type: "note", statut_bureau: "traite", chantier_id: "ch1", auteur: "Paul", derniere_activite: "2026-10-14T15:00:00Z" },
  { id: "b", type: "signaler", statut_bureau: "lu", chantier_id: "ch1", auteur: "Marc", derniere_activite: "2026-10-14T08:00:00Z" },
  { id: "c", type: "astuce", statut_bureau: "nouveau", chantier_id: "ch2", auteur: "Inès", derniere_activite: "2026-10-14T09:00:00Z" },
  { id: "d", type: "note", statut_bureau: "lu", chantier_id: null, auteur: "Paul", derniere_activite: "2026-10-14T14:00:00Z" },
  { id: "e", type: "signaler", statut_bureau: "traite", chantier_id: "ch2", auteur: "Hugo", derniere_activite: "2026-10-14T16:00:00Z" },
];
eq(filtrerNotesBureau(B).map(n => n.id), ["b", "c", "d"], "à traiter = nouveau ou lu");
eq(filtrerNotesBureau(B, { filtre: "traite" }).map(n => n.id), ["a", "e"], "traitées");
eq(filtrerNotesBureau(B, { filtre: "toutes", auteur: "ines" }).map(n => n.id), ["c"], "filtre ouvrier sans accent");
eq(filtrerNotesBureau(B, { filtre: "toutes", type: "signaler", chantierId: "ch1" }).map(n => n.id), ["b"], "filtres type + chantier");
eq(trierNotesBureau(B).map(n => n.id), ["b", "c", "e", "a", "d"], "tri : à signaler ouvertes, puis nouvelles, puis le reste par activité");
eq(compteursBureau(B), { nouvelles: 1, signalees: 1, aTraiter: 3, traitees: 2 }, "compteurs bureau");
ok(estATraiter({ statut_bureau: null }), "sans suivi : à traiter");
eq(libelleSuivi({ partage_bureau: true, statut_bureau: "nouveau" }), "Pas encore lue par le bureau", "suivi : nouveau");
eq(libelleSuivi({ partage_bureau: true, statut_bureau: "traite", statut_par: "Claire", statut_le: "2026-10-14" }, d => `[${d}]`),
  "Traité par Claire le [2026-10-14]", "suivi : traité, par qui, quand");
eq(libelleSuivi({ statut_bureau: "traite" }), "", "note non partagée au bureau : aucun suivi affiché");
eq(cheminPhoto("u1", "abc", "image/png"), "u1/abc.png", "chemin photo : dossier = identifiant du compte");
eq(cheminPhoto("u1", "abc"), "u1/abc.jpg", "chemin photo : JPEG par défaut");

// ═══ 2. La migration ne touche à rien d'existant ═════════════════════════════
// Policies touchées : celles des 3 nouvelles tables (dont la restrictive
// « collaborateurs seulement », posée par une boucle sur ces 3 tables) et les
// 3 du nouveau bucket — rien d'autre.
const policiesTouchees = [...MIGRATION.matchAll(/(?:create|drop|alter)\s+policy(?:\s+if\s+exists)?\s+(\w+)\s+on\s+([\w.%]+)/gi)]
  .map(m => `${m[2]}:${m[1]}`);
ok(policiesTouchees.length > 0 && policiesTouchees.every(p =>
  /^public\.notes_ouvriers(_reponses|_lectures)?:notes_/.test(p)
  || /^storage\.objects:notes_ouvriers_photos_(insert|select|delete)$/.test(p)
  || p === "public.%I:profero_collaborateurs_seulement"),
  `seules les policies des nouvelles tables / du nouveau bucket sont touchées (${policiesTouchees.join(", ")})`);
ok(/foreach t in array array\['notes_ouvriers', 'notes_ouvriers_reponses', 'notes_ouvriers_lectures'\]/.test(MIGRATION),
  "la policy restrictive n'est posée que sur les 3 nouvelles tables");
ok(!/drop\s+policy\s+if\s+exists\s+profero_collaborateurs_seulement\s+on\s+storage/i.test(MIGRATION), "la policy restrictive de storage n'est pas touchée");
ok(!/alter\s+table\s+public\.(?!notes_ouvriers)/i.test(MIGRATION), "aucune table existante modifiée");
ok(!/create\s+or\s+replace\s+function\s+public\.(mon_role|est_ouvrier|mon_prenom_planning|norm_prenom|est_collaborateur_actif)\b/i.test(MIGRATION),
  "aucun helper de rôle redéfini");

// ═══ 3. Réplique PostgreSQL ══════════════════════════════════════════════════
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
const U = {
  paul:   { email: "paul@test.fr",   uid: "00000000-0000-0000-0000-00000000000a" },
  marc:   { email: "marc@test.fr",   uid: "00000000-0000-0000-0000-00000000000b" },
  hugo:   { email: "hugo@test.fr",   uid: "00000000-0000-0000-0000-00000000000c" },
  ines:   { email: "ines@test.fr",   uid: "00000000-0000-0000-0000-00000000000d" },
  bureau: { email: "bureau@test.fr", uid: "00000000-0000-0000-0000-00000000000e" },
  admin:  { email: "admin@test.fr",  uid: "00000000-0000-0000-0000-00000000000f" },
  inconnu:{ email: "inconnu@test.fr", uid: "00000000-0000-0000-0000-000000000010" },
};
await db.exec(`
  create extension if not exists plpgsql;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create table public.utilisateurs (email text, nom text, role text, actif boolean, prenom_planning text);
  -- Helpers : définitions de PRODUCTION (relevées le 14/10/2026).
  create function public.mon_role() returns text language sql stable security definer set search_path = public as $$
    select u.role from public.utilisateurs u where u.email = auth.email() and u.actif is true limit 1; $$;
  create function public.est_ouvrier() returns boolean language sql stable security definer set search_path = public as $$
    select public.mon_role() = 'ouvrier'; $$;
  create function public.mon_prenom_planning() returns text language sql stable security definer set search_path = public as $$
    select prenom_planning from public.utilisateurs where email = auth.email() limit 1; $$;
  -- norm_prenom : en production lower(regexp_replace(trim(unaccent(t)), '\\s+', ' ', 'g')) ;
  -- unaccent n'existe pas dans PGlite : translate() des accents utiles au test.
  create function public.norm_prenom(t text) returns text language sql stable as $$
    select lower(regexp_replace(trim(translate(coalesce(t, ''), 'ÉÈÊËéèêëÏÎïîÇç', 'EEEEeeeeIIiiCc')), '\\s+', ' ', 'g')); $$;
  -- est_collaborateur_actif : réduit ici à « fiche active pour cette adresse ».
  create function public.est_collaborateur_actif() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.utilisateurs u where u.email = auth.email() and u.actif is true); $$;
  grant execute on all functions in schema public to authenticated;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, service_role;
  grant all on all tables in schema storage to service_role;
  grant select, insert, delete on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
  -- Un autre bucket, déjà ouvert : ne doit pas être affecté.
  create policy autre_bucket on storage.objects for select to authenticated using (bucket_id = 'photos');
  grant usage on schema public to authenticated, anon;

  insert into public.utilisateurs values
    ('paul@test.fr',   null,            'ouvrier',    true,  'Paul'),
    ('marc@test.fr',   null,            'ouvrier',    true,  'Marc'),
    ('hugo@test.fr',   null,            'ouvrier',    true,  'Hugo'),
    ('ines@test.fr',   null,            'ouvrier',    false, 'Inès'),
    ('bureau@test.fr', 'Claire Bureau', 'conducteur', true,  null),
    ('admin@test.fr',  'Admin Test',    'admin',      true,  null);
  insert into storage.objects (bucket_id, name) values ('photos', 'public/x.jpg');
`);

await db.exec(MIGRATION);
await db.exec(MIGRATION);
nbOk++; // rejouable

// Exécute sql sous une identité. persister=false : transaction annulée.
async function sous(qui, sql, { persister = false, params = [] } = {}) {
  const role = qui === "anon" ? "anon" : qui === "service" ? "service_role" : "authenticated";
  const claims = (qui === "anon" || qui === "service") ? { role } : { role, email: U[qui].email, sub: U[qui].uid };
  let out;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.query(`select set_config('role', $1, true)`, [role]);
      const r = await tx.query(sql, params);
      out = { rows: r.rows, n: r.affectedRows ?? r.rows.length };
      if (!persister) throw new Error("__annuler__");
    });
  } catch (e) {
    if (e.message !== "__annuler__") out = { erreur: e.message };
  }
  return out;
}
const creer = async (qui, champs) => {
  const cols = Object.keys(champs), vals = Object.values(champs);
  const r = await sous(qui, `insert into public.notes_ouvriers (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
    { persister: true, params: vals });
  if (r.erreur) throw new Error(`création refusée pour ${qui} : ${r.erreur}`);
  return r.rows[0];
};
const voit = async (qui, id) => {
  const r = await sous(qui, `select id from public.notes_ouvriers where id = $1`, { params: [id] });
  return !r.erreur && r.rows.length === 1;
};
const lire = async (id) => (await sous("service", `select * from public.notes_ouvriers where id = $1`, { params: [id] })).rows[0];

// ── Note privée ─────────────────────────────────────────────────────────────
const prive = await creer("paul", { titre: "Ma mesure", contenu: "2,43 m", photos: JSON.stringify([`${U.paul.uid}/p1.jpg`]) });
ok(await voit("paul", prive.id), "privée : l'auteur la voit");
for (const qui of ["marc", "hugo", "bureau", "admin", "ines", "inconnu", "anon"]) {
  ok(!(await voit(qui, prive.id)), `privée : ${qui} ne la voit pas`);
}
eq(prive.statut_bureau, null, "privée : aucun suivi bureau");
const majPriveeBureau = await sous("admin", `update public.notes_ouvriers set statut_bureau = 'traite' where id = '${prive.id}'`);
eq(majPriveeBureau.n, 0, "privée : l'admin ne peut même pas la toucher");

// ── Auteur imposé, partage normalisé ────────────────────────────────────────
const partagee = await creer("paul", {
  titre: "Fuite", contenu: "Sous l'évier", auteur: "Marc", auteur_uid: U.marc.uid, statut_bureau: "traite",
  partage_bureau: true, partage_ouvriers: ["  MARC ", "marc", "Paul", "", "Hugo "],
  checklist: JSON.stringify([{ id: "a", texte: "couper l'eau", fait: false }]),
  photos: JSON.stringify([`${U.paul.uid}/p2.jpg`]),
});
eq([partagee.auteur, partagee.auteur_uid], ["Paul", U.paul.uid], "auteur et identifiant imposés par la base (pas d'usurpation)");
eq(partagee.partage_ouvriers, ["Hugo", "MARC"], "partage : sans doublon (casse/espaces), sans soi-même");
eq(partagee.statut_bureau, "nouveau", "partagée au bureau : suivi « nouveau », quoi qu'envoie le client");
ok(await voit("marc", partagee.id) && await voit("hugo", partagee.id) && await voit("bureau", partagee.id) && await voit("admin", partagee.id),
  "partagée : collègues nommés et bureau la voient");
ok(!(await voit("ines", partagee.id)), "partagée : un ouvrier inactif ne la voit pas, même nommé ailleurs");

const seulMarc = await creer("paul", { titre: "Pour Marc", partage_ouvriers: ["Marc"] });
ok(await voit("marc", seulMarc.id) && !(await voit("hugo", seulMarc.id)), "partage nominatif : Marc oui, Hugo non");
ok(!(await voit("bureau", seulMarc.id)), "partage entre ouvriers seulement : le bureau ne la voit pas");
eq(seulMarc.statut_bureau, null, "partage entre ouvriers : aucun suivi bureau");

// ── Droits d'écriture ───────────────────────────────────────────────────────
eq((await sous("marc", `update public.notes_ouvriers set contenu = 'piraté' where id = '${partagee.id}'`)).n, 0, "un collègue ne modifie pas la note");
eq((await sous("marc", `delete from public.notes_ouvriers where id = '${partagee.id}'`)).n, 0, "un collègue ne supprime pas la note");
ok(/bureau ne peut modifier que le suivi/.test((await sous("bureau", `update public.notes_ouvriers set contenu = 'x' where id = '${partagee.id}'`)).erreur || ""),
  "le bureau ne peut pas réécrire le contenu");
ok((await sous("bureau", `insert into public.notes_ouvriers (auteur, titre) values ('Bureau', 'x')`)).erreur, "le bureau ne crée pas de note");
ok((await sous("anon", `insert into public.notes_ouvriers (auteur, titre) values ('x', 'x')`)).erreur, "anonyme : aucune écriture");
ok((await sous("ines", `insert into public.notes_ouvriers (auteur, titre) values ('x', 'x')`)).erreur, "ouvrier inactif : aucune écriture");

const suivi = await sous("bureau", `update public.notes_ouvriers set statut_bureau = 'traite', statut_par = 'Usurpé' where id = '${partagee.id}' returning statut_bureau, statut_par, statut_le`, { persister: true });
eq([suivi.rows[0].statut_bureau, suivi.rows[0].statut_par], ["traite", "Claire Bureau"], "suivi bureau : statut changé, « par » imposé (nom du compte)");
ok(suivi.rows[0].statut_le, "suivi bureau : date posée");

const coche = await sous("paul", `update public.notes_ouvriers set checklist = '[{"id":"a","texte":"couper l''eau","fait":true}]'::jsonb where id = '${partagee.id}' returning statut_bureau`, { persister: true });
eq(coche.rows[0].statut_bureau, "traite", "cocher une case ne relance pas le suivi du bureau");
const tentativeSuivi = await sous("paul", `update public.notes_ouvriers set statut_bureau = 'lu' where id = '${partagee.id}' returning statut_bureau`, { persister: true });
eq(tentativeSuivi.rows[0].statut_bureau, "traite", "l'auteur ne change pas lui-même le suivi du bureau");
const modif = await sous("paul", `update public.notes_ouvriers set contenu = 'Sous l''évier, ça empire' where id = '${partagee.id}' returning statut_bureau, statut_par`, { persister: true });
eq([modif.rows[0].statut_bureau, modif.rows[0].statut_par], ["nouveau", null], "modifier une note traitée la renvoie « nouveau » au bureau");

// ── Réponses ────────────────────────────────────────────────────────────────
const repMarc = await sous("marc", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote, auteur_uid) values ('${partagee.id}', '  Je passe demain  ', 'Bureau', 'bureau', '${U.paul.uid}') returning auteur, cote, auteur_uid, contenu`, { persister: true });
eq(repMarc.rows[0], { auteur: "Marc", cote: "ouvrier", auteur_uid: U.marc.uid, contenu: "Je passe demain" }, "réponse : auteur, côté et identité imposés");
await sous("bureau", `update public.notes_ouvriers set statut_bureau = 'traite' where id = '${partagee.id}'`, { persister: true });
await sous("hugo", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote) values ('${partagee.id}', 'Moi aussi', '-', 'ouvrier')`, { persister: true });
const apresRep = await lire(partagee.id);
eq([apresRep.statut_bureau, apresRep.derniere_activite_par], ["nouveau", U.hugo.uid], "réponse d'un ouvrier : la note remonte et redevient « nouveau »");
const repBureau = await sous("bureau", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote) values ('${partagee.id}', 'Plombier prévenu', '-', 'ouvrier') returning auteur, cote`, { persister: true });
eq(repBureau.rows[0], { auteur: "Claire Bureau", cote: "bureau" }, "réponse du bureau : signée du nom du compte");
eq((await lire(partagee.id)).statut_bureau, "nouveau", "réponse du bureau : le suivi ne bouge pas");
ok((await sous("ines", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote) values ('${partagee.id}', 'x', '-', 'ouvrier')`)).erreur,
  "réponse : refusée à qui ne voit pas la note");
ok((await sous("bureau", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote) values ('${prive.id}', 'x', '-', 'bureau')`)).erreur,
  "réponse : le bureau ne peut pas répondre à une note privée");
ok((await sous("marc", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote) values ('${partagee.id}', '   ', '-', 'ouvrier')`)).erreur,
  "réponse vide refusée");
eq((await sous("hugo", `select count(*)::int as n from public.notes_ouvriers_reponses where note_id = '${partagee.id}'`)).rows[0].n, 3, "réponses lisibles par qui voit la note");
await sous("marc", `insert into public.notes_ouvriers_reponses (note_id, contenu, auteur, cote) values ('${seulMarc.id}', 'Vu', '-', 'ouvrier')`, { persister: true });
eq((await sous("hugo", `select count(*)::int as n from public.notes_ouvriers_reponses where note_id = '${seulMarc.id}'`)).rows[0].n, 0,
  "réponses d'une note invisible : illisibles");
eq((await sous("bureau", `select count(*)::int as n from public.notes_ouvriers_reponses where note_id = '${seulMarc.id}'`)).rows[0].n, 0,
  "réponses entre ouvriers : illisibles pour le bureau");
eq((await sous("paul", `delete from public.notes_ouvriers_reponses where auteur = 'Marc'`)).n, 0, "on ne supprime pas la réponse d'un autre");

// ── Lectures ────────────────────────────────────────────────────────────────
ok(!(await sous("marc", `insert into public.notes_ouvriers_lectures (note_id, lecteur_uid) values ('${partagee.id}', '${U.marc.uid}')`)).erreur, "lecture : enregistrée sur une note visible");
ok((await sous("marc", `insert into public.notes_ouvriers_lectures (note_id, lecteur_uid) values ('${prive.id}', '${U.marc.uid}')`)).erreur, "lecture : refusée sur une note invisible");
ok((await sous("marc", `insert into public.notes_ouvriers_lectures (note_id, lecteur_uid) values ('${partagee.id}', '${U.paul.uid}')`)).erreur, "lecture : jamais au nom d'un autre");

// ── Mémo chantier ───────────────────────────────────────────────────────────
const memoCh = await creer("marc", { titre: "Digicode", contenu: "4521B", chantier_id: "ch1", memo_chantier: true });
for (const qui of ["paul", "hugo", "bureau", "admin"]) ok(await voit(qui, memoCh.id), `mémo : ${qui} le voit`);
ok(!(await voit("ines", memoCh.id)) && !(await voit("anon", memoCh.id)), "mémo : ni ouvrier inactif ni anonyme");
eq(memoCh.statut_bureau, "nouveau", "mémo : suivi « nouveau » pour le bureau");
eq((await sous("paul", `update public.notes_ouvriers set contenu = 'x' where id = '${memoCh.id}'`)).n, 0, "mémo : seul son auteur le modifie");
ok((await sous("paul", `insert into public.notes_ouvriers (titre, memo_chantier) values ('x', true)`)).erreur, "mémo sans chantier : refusé par la base");

// Redevenir privée : le bureau ne la voit plus.
await sous("paul", `update public.notes_ouvriers set partage_bureau = false, partage_ouvriers = '{}' where id = '${partagee.id}'`, { persister: true });
ok(!(await voit("bureau", partagee.id)) && !(await voit("marc", partagee.id)), "repassée privée : plus visible par le bureau ni les collègues");
eq((await lire(partagee.id)).statut_bureau, null, "repassée privée : suivi effacé");
await sous("paul", `update public.notes_ouvriers set partage_bureau = true, partage_ouvriers = '{Marc}' where id = '${partagee.id}'`, { persister: true });

// ── Destinataires ───────────────────────────────────────────────────────────
eq((await sous("paul", `select * from public.notes_destinataires() d`)).rows.map(r => r.d ?? Object.values(r)[0]), ["Hugo", "Marc"],
  "destinataires : comptes ouvriers actifs, sans soi-même, prénoms seuls");
ok((await sous("anon", `select * from public.notes_destinataires()`)).erreur, "destinataires : refusé à l'anonyme");
eq((await sous("ines", `select * from public.notes_destinataires()`)).rows.length, 0, "destinataires : rien pour un compte inactif");

// ── Photos (bucket privé) ───────────────────────────────────────────────────
eq((await sous("service", `select public from storage.buckets where id = 'notes-ouvriers'`)).rows[0].public, false, "bucket notes-ouvriers privé");
const depot = (qui, nom) => sous(qui, `insert into storage.objects (bucket_id, name) values ('notes-ouvriers', '${nom}')`);
ok(!(await depot("paul", `${U.paul.uid}/p9.jpg`)).erreur, "photo : dépôt dans son propre dossier");
ok((await depot("paul", `${U.marc.uid}/p9.jpg`)).erreur, "photo : jamais dans le dossier d'un autre");
ok((await depot("bureau", `${U.bureau.uid}/p9.jpg`)).erreur, "photo : le bureau ne dépose pas");
await sous("service", `insert into storage.objects (bucket_id, name) values ('notes-ouvriers', '${U.paul.uid}/p1.jpg'), ('notes-ouvriers', '${U.paul.uid}/p2.jpg')`, { persister: true });
const voitPhoto = async (qui, nom) => (await sous(qui, `select 1 from storage.objects where bucket_id = 'notes-ouvriers' and name = '${nom}'`)).rows?.length === 1;
ok(await voitPhoto("paul", `${U.paul.uid}/p1.jpg`), "photo d'une note privée : visible par son auteur");
for (const qui of ["marc", "bureau", "admin"]) ok(!(await voitPhoto(qui, `${U.paul.uid}/p1.jpg`)), `photo d'une note privée : invisible pour ${qui}`);
ok(await voitPhoto("marc", `${U.paul.uid}/p2.jpg`) && await voitPhoto("bureau", `${U.paul.uid}/p2.jpg`), "photo d'une note partagée : visible des destinataires");
ok(!(await voitPhoto("hugo", `${U.paul.uid}/p2.jpg`)), "photo d'une note partagée : invisible pour un non-destinataire");
eq((await sous("hugo", `select count(*)::int as n from storage.objects where bucket_id = 'photos'`)).rows[0].n, 1, "le bucket « photos » garde ses propres règles");

// ── Bilan : aucune note privée ne fuit vers le bureau ───────────────────────
const vuesAdmin = (await sous("admin", `select id from public.notes_ouvriers`)).rows.map(r => r.id);
ok(!vuesAdmin.includes(prive.id) && !vuesAdmin.includes(seulMarc.id), "l'admin ne voit aucune note privée ni partagée entre ouvriers seulement");

// ── Retour arrière ──────────────────────────────────────────────────────────
await sous("service", `delete from storage.objects where bucket_id = 'notes-ouvriers'`, { persister: true });
await db.exec(ROLLBACK);
eq((await db.query(`select to_regclass('public.notes_ouvriers') as t`)).rows[0].t, null, "retour arrière : tables supprimées");
eq((await db.query(`select count(*)::int as n from storage.buckets where id = 'notes-ouvriers'`)).rows[0].n, 0, "retour arrière : bucket supprimé");
eq((await db.query(`select count(*)::int as n from pg_policies where policyname = 'autre_bucket'`)).rows[0].n, 1, "retour arrière : policies existantes intactes");
await db.exec(MIGRATION);
nbOk++; // se réapplique après retour arrière

console.log(`✓ Notes des ouvriers : ${nbOk} contrôles OK`);
