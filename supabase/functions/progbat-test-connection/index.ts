import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// progbat-test-connection
// Test de connexion STRICTEMENT EN LECTURE SEULE à l'API ProGBat.
//
// Objectif : vérifier que le jeton d'accès privé ProGBat fonctionne et qu'il
// correspond bien au compte Profero Rénovation, AVANT toute synchronisation
// (bibliothèque, devis…). Aucune écriture, ni dans ProGBat, ni dans Supabase.
//
// Endpoints ProGBat utilisés (documentation officielle, OpenAPI
// https://progbat.readme.io/reference/me.md et .../my-company.md) :
//   GET https://api.progbat.com/v2/me          scope `profile` ou `profile.read`
//       → profil de l'utilisateur porteur du jeton (id, firstname, lastname, email…)
//   GET https://api.progbat.com/v2/clients/me  scope `profile` ou `company-accounts.read`
//       → tableau des sociétés du compte (id, legalName, businessName, siren…)
//
// DIAGNOSTIC DE FACTURATION (lot diagnostique, lecture seule) — s'ajoute au
// test ci-dessus sans le remplacer :
//   GET /company/bills?limit=20&offset=0[&sort]        scope `bills` ou `bills.read`
//   GET /company/transactions?limit=50&offset=0[&sort] scope `transactions` ou
//       `transactions.read` (les deux sont documentés ; la synchronisation à
//       venir restera strictement en lecture et n'utilisera que la variante
//       `.read`)
//   GET /company/bills/{billId}       (4 au maximum)    scope `bills` ou `bills.read`
//       → montants détaillés d'un échantillon représentatif de factures, pour
//         comprendre l'articulation entre atiTotal (cumulatif sur une situation)
//         et toBePaid (exigible après déduction des acomptes)
//   GET /company/bills/{billId}/pdf                    scope `bills` ou `bills.read`
//       → uniquement le code HTTP, le Content-Type et la TAILLE reçue. Le PDF
//         n'est ni renvoyé, ni enregistré, ni journalisé.
// Aucun autre verbe que GET n'est employé : cette fonction ne peut rien écrire
// dans ProGBat, par construction.
//
// POURQUOI UNE LISTE BLANCHE DE CHAMPS : les réponses /company/bills portent le
// nom, l'adresse et les coordonnées du client ; /company/transactions porte des
// libellés bancaires et le compte d'origine. Les échantillons renvoyés sont donc
// RECONSTRUITS champ par champ (CHAMPS_FACTURE / projeterTransaction) : tout ce
// qui n'est pas explicitement listé ne peut pas sortir, même si ProGBat ajoute
// des champs demain.
//
// SÉMANTIQUE NON DOCUMENTÉE : `status` et `validated` (entiers) n'ont aucune
// signification documentée côté ProGBat, et `checking[].docType` n'a pas de
// valeurs énumérées. Ce diagnostic les REMONTE TELS QUELS, avec leur nombre
// d'occurrences, sans les interpréter — c'est précisément ce qu'il sert à
// établir sur des données réelles.
//
// DEUX SECRETS, DEUX USAGES — c'est ce qui permet au jeton de facturation de
// n'avoir QUE bills.read + transactions.read, sans profile.read :
//   identityToken = PROGBAT_PRIVATE_ACCESS_TOKEN, à défaut PROGBAT_BILLING_…
//       → /me et /clients/me (profile.read)
//   billingToken  = PROGBAT_BILLING_ACCESS_TOKEN, à défaut PROGBAT_PRIVATE_…
//       → /company/bills, /company/transactions, /company/bills/{id}/pdf
// Chacun retombe sur l'autre s'il manque : un seul secret configuré suffit
// pour que le test entier fonctionne. `token_source` décrit UNIQUEMENT le
// jeton utilisé pour le diagnostic de facturation ("billing" | "legacy").
// PROGBAT_CLIENT_ID / PROGBAT_CLIENT_SECRET ne sont volontairement PAS utilisés
// ici (réservés au futur flux OAuth).
// Aucun jeton n'est jamais renvoyé, ni journalisé, ni inclus dans un message.
//
// Accès : utilisateur Supabase authentifié, profil `utilisateurs` actif et
// rôle « bureau » (tout rôle sauf `ouvrier`) — même règle que le routeur de
// l'application (App.jsx → destForProfil) et que admin-users-local.
//
// Appel (POST ou GET, corps vide) :
//   supabase.functions.invoke("progbat-test-connection")
// Réponse (jamais de donnée sensible) :
//   { ok, progbat_status, message, utilisateur: { prenom, nom, email },
//     entreprise: { id, nom } | null, entreprises: [{ id, nom }], entreprise_status }
//
// Déploiement :
//   npx supabase functions deploy progbat-test-connection --project-ref <ref>
//   (« Verify JWT » activé)
// ─────────────────────────────────────────────────────────────────────────────

const PROGBAT_API = "https://api.progbat.com/v2"
const TIMEOUT_MS = 10_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

// Nettoie un message d'erreur venant de ProGBat avant de le renvoyer :
// texte court, sans séquence ressemblant à un jeton ou une clé.
const nettoyerMessage = (raw: unknown): string => {
  let s = typeof raw === "string" ? raw : ""
  s = s.replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim()
  return s.slice(0, 200)
}

// Message lisible selon le code HTTP ProGBat.
// `scopeAttendu` = le scope requis PAR L'APPEL en cours (chaque endpoint a le
// sien) : un 403 sur /company/bills ne se diagnostique pas avec le scope de
// /me. Seul un 403 permet de conclure à un scope manquant.
const messagePourStatus = (status: number, detail: string, scopeAttendu = "profile.read"): string => {
  const suffix = detail ? ` (${detail})` : ""
  if (status === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué." + suffix
  if (status === 403) return `Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis (${scopeAttendu}).` + suffix
  if (status === 404) return "Endpoint ProGBat introuvable (404) : l'API a peut-être changé." + suffix
  if (status === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes." + suffix
  if (status >= 500) return `ProGBat indisponible (${status}) : erreur côté serveur ProGBat, réessayer plus tard.` + suffix
  return `Réponse inattendue de ProGBat (${status}).` + suffix
}

type ProgbatResult =
  | { ok: true; status: number; data: unknown; contentRange: string | null }
  | { ok: false; status: number; message: string; contentRange: string | null }

// GET en lecture seule sur l'API ProGBat, avec délai maximal.
// Ne journalise jamais les en-têtes ni le corps ; ne renvoie jamais le corps brut en erreur.
async function progbatGet(path: string, token: string, scopeAttendu = "profile.read"): Promise<ProgbatResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    })
    // En-tête de pagination : présent sur les listes de la bibliothèque, à
    // confirmer sur /bills et /transactions — d'où sa remontée telle quelle.
    const contentRange = res.headers.get("content-range")
    if (!res.ok) {
      let detail = ""
      try {
        const body = await res.json()
        detail = nettoyerMessage(body?.message ?? body?.error_description ?? body?.error ?? "")
      } catch { /* corps non JSON : ignoré */ }
      return { ok: false, status: res.status, message: messagePourStatus(res.status, detail, scopeAttendu), contentRange }
    }
    const data = await res.json().catch(() => null)
    return { ok: true, status: res.status, data, contentRange }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, status: 0, message: `ProGBat n'a pas répondu en ${TIMEOUT_MS / 1000} s (délai dépassé).`, contentRange: null }
    }
    return { ok: false, status: 0, message: "Connexion à ProGBat impossible (réseau ou DNS).", contentRange: null }
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC DE FACTURATION — helpers (lecture seule, aucune interprétation)
// ─────────────────────────────────────────────────────────────────────────────

// Liste paginée avec tri, et UNE seule reprise sans tri si la requête est
// refusée comme invalide (400/422). Jamais de boucle. Un 401/403/429 n'est pas
// un problème de tri : on ne réessaie pas, le code d'erreur est ce qui compte.
async function listerProgbat(
  chemin: string, tri: string, limit: number, token: string, scopeAttendu: string,
): Promise<{ r: ProgbatResult; tri_applique: boolean; tri_refuse: boolean }> {
  const base = `${chemin}?limit=${limit}&offset=0`
  const r1 = await progbatGet(`${base}&sort=${encodeURIComponent(tri)}`, token, scopeAttendu)
  if (r1.ok || (r1.status !== 400 && r1.status !== 422)) {
    return { r: r1, tri_applique: r1.ok, tri_refuse: false }
  }
  const r2 = await progbatGet(base, token, scopeAttendu)
  return { r: r2, tri_applique: false, tri_refuse: true }
}

// Valeurs distinctes observées, avec leur nombre d'occurrences. Sert à établir
// EMPIRIQUEMENT ce que valent `status`, `validated` et `docType` : aucune de ces
// valeurs n'est interprétée ici.
const valeursDistinctes = (valeurs: unknown[]) => {
  const map = new Map<string, { valeur: unknown; occurrences: number }>()
  for (const v of valeurs) {
    const cle = v === null || v === undefined ? "(absent)" : String(v)
    const e = map.get(cle)
    if (e) e.occurrences++
    else map.set(cle, { valeur: v ?? null, occurrences: 1 })
  }
  return [...map.values()].sort((a, b) => b.occurrences - a.occurrences)
}

// LISTE BLANCHE des champs de facture renvoyés. Tout le reste (clientName,
// clientAddress, clientPostcode, clientCity, businessAddress…) est écarté par
// construction : on RECONSTRUIT l'objet, on ne le filtre pas.
const CHAMPS_FACTURE = [
  "id", "code", "type", "documentDate", "dueDate", "quoteId", "businessId",
  "yardId", "situationNumber", "status", "validated", "einvoiceStatus",
  "netTotal", "taxes", "atiTotal", "toBePaid", "holdback", "revisionNumber",
] as const

const projeterFacture = (b: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const c of CHAMPS_FACTURE) out[c] = b?.[c] ?? null
  return out
}

// Idem pour les transactions : bankAccountId, label, paymentNumber,
// paymentMode, ctime et checking[].thirdId ne sortent JAMAIS (données
// bancaires ou identifiant de tiers).
const MAX_CHECKING = 20 // borne de charge utile, signalée si atteinte

const projeterTransaction = (t: Record<string, unknown>) => {
  const checking = Array.isArray(t?.checking) ? t.checking as Record<string, unknown>[] : []
  return {
    id: t?.id ?? null,
    date: t?.date ?? null,
    amount: typeof t?.amount === "number" ? t.amount : null,
    canceled: t?.canceled ?? null,
    checked: t?.checked ?? null,
    checking_total: checking.length,
    checking: checking.slice(0, MAX_CHECKING).map((c) => ({
      docType: c?.docType ?? null,
      docId: c?.docId ?? null,
      amount: typeof c?.amount === "number" ? c.amount : null,
    })),
  }
}

// ── Détail financier de quelques factures (GET /company/bills/{id}) ─────────
// Pourquoi : sur une facture de situation, `atiTotal` est CUMULATIF tandis que
// `toBePaid` semble être l'exigible après déduction des acomptes. Le détail
// unitaire porte les champs qui permettent de trancher (dealTotal vs total,
// achievement / previousAchievement, deductedAdvance, atiDeductions, holdback).
// Ce lot les remonte TELS QUELS : aucune formule n'est calculée ici.
//
// Seconde liste blanche, distincte de CHAMPS_FACTURE : le détail d'une facture
// porte en plus `content[]` (les LIGNES de la facture) et tout le bloc client —
// rien de tout cela ne doit sortir.
const CHAMPS_DETAIL_FACTURE = [
  "id", "code", "type", "documentDate", "quoteId", "situationNumber",
  "status", "validated",
  "dealTotal", "dealReduction", "dealNetTotal", "dealTaxes", "dealAtiTotal",
  "achievement", "previousAchievement",
  "total", "reduction", "netDeductions", "netTotal",
  "taxRate", "taxes", "atiTotal",
  "holdback", "deductedAdvance", "toBePaid", "atiDeductions",
  "dgd", "taxDetails", "deductions",
] as const

const MAX_SOUS_LIGNES = 20 // borne de charge utile sur taxDetails / deductions

const projeterDetailFacture = (b: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const c of CHAMPS_DETAIL_FACTURE) {
    const v = b?.[c] ?? null
    out[c] = Array.isArray(v) ? v.slice(0, MAX_SOUS_LIGNES) : v
  }
  return out
}

const estValidee = (f: Record<string, unknown>) => {
  const v = typeof f.validated === "number" ? f.validated : Number(f.validated)
  return Number.isFinite(v) && v !== 0
}
const nombreOuNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

// Choisit au plus QUATRE factures représentatives dans l'échantillon déjà
// récupéré (aucun appel supplémentaire pour choisir). Un brouillon
// (validated = 0) n'est JAMAIS retenu. Une facture qui répond à deux critères
// n'est prise qu'une fois, et le critère qui l'a fait retenir est conservé.
function choisirFacturesADetailler(factures: Record<string, unknown>[]) {
  const ecartTotal = (f: Record<string, unknown>) => {
    const a = nombreOuNull(f.atiTotal), t = nombreOuNull(f.toBePaid)
    return a !== null && t !== null && a !== t
  }
  const criteres: { critere: string; test: (f: Record<string, unknown>) => boolean }[] = [
    { critere: "bill validée et réglée (status=1) avec toBePaid ≠ atiTotal",
      test: (f) => f.type === "bill" && estValidee(f) && Number(f.status) === 1 && ecartTotal(f) },
    { critere: "bill validée non réglée (status=0) avec toBePaid ≠ atiTotal",
      test: (f) => f.type === "bill" && estValidee(f) && Number(f.status) === 0 && ecartTotal(f) },
    { critere: "facture d'acompte (type=advance) validée",
      test: (f) => f.type === "advance" && estValidee(f) },
    { critere: "facture validée à montant négatif (avoir)",
      test: (f) => estValidee(f) && ((nombreOuNull(f.atiTotal) ?? 0) < 0 || (nombreOuNull(f.toBePaid) ?? 0) < 0) },
  ]
  const retenues: { id: unknown; critere: string }[] = []
  const vus = new Set<string>()
  for (const c of criteres) {
    const f = factures.find((x) => {
      const k = String(x.id)
      return !vus.has(k) && estValidee(x) && c.test(x)
    })
    if (!f) continue
    vus.add(String(f.id))
    retenues.push({ id: f.id, critere: c.critere })
  }
  return retenues.slice(0, 4) // garde-fou : jamais plus de 4 appels de détail
}

// Clé de comparaison d'identifiant : correspondance EXACTE sur la valeur
// numérique (ProGBat type `docId` et `bill.id` en entiers).
const cleId = (v: unknown): string | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) ? String(n) : null
}

// scope_accessible : false SEULEMENT sur un 403 (scope manquant). Une panne
// réseau ou un 500 ne dit rien du scope → null, et le message explique.
const scopeAccessible = (r: ProgbatResult) => r.ok ? true : (r.status === 403 ? false : null)

// Test du PDF d'une facture : GET seul. Le corps est lu UNIQUEMENT pour en
// mesurer la taille, puis abandonné — rien n'est renvoyé ni enregistré.
async function testerPdfFacture(billId: unknown, token: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${PROGBAT_API}/company/bills/${encodeURIComponent(String(billId))}/pdf`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
      signal: ctrl.signal,
    })
    const contentType = res.headers.get("content-type")
    let taille: number | null = null
    if (res.ok) {
      const buf = await res.arrayBuffer()   // mesuré puis oublié : jamais stocké
      taille = buf.byteLength
    } else {
      await res.body?.cancel().catch(() => {})
    }
    return {
      teste: true, bill_id: billId, http_status: res.status,
      content_type: contentType, taille_octets: taille, ok: res.ok,
      ...(res.ok ? {} : { message: messagePourStatus(res.status, "", "bills.read") }),
    }
  } catch (err) {
    const delai = (err as Error)?.name === "AbortError"
    return {
      teste: true, bill_id: billId, http_status: 0, content_type: null,
      taille_octets: null, ok: false,
      message: delai
        ? `ProGBat n'a pas répondu en ${TIMEOUT_MS / 1000} s (délai dépassé).`
        : "Connexion à ProGBat impossible (réseau ou DNS).",
    }
  } finally {
    clearTimeout(timer)
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405)

  const t0 = Date.now()
  try {
    // ── 1. Appelant : utilisateur Supabase authentifié, profil bureau actif ──
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    if (!jwt) return json({ ok: false, error: "Non authentifié." }, 401)
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt)
    if (callerErr || !caller?.email) return json({ ok: false, error: "Non authentifié." }, 401)

    const { data: profil } = await admin
      .from("utilisateurs")
      .select("role, actif")
      .eq("email", caller.email.toLowerCase())
      .maybeSingle()
    // Même règle que l'application : compte actif et rôle bureau (≠ ouvrier).
    if (!profil || profil.actif === false || profil.role === "ouvrier") {
      return json({ ok: false, error: "Test réservé aux utilisateurs du bureau." }, 403)
    }

    // ── 2. Secrets ProGBat (jamais renvoyés ni journalisés) ─────────────────
    // DEUX JETONS DISTINCTS, parce qu'ils n'ont pas les mêmes besoins :
    //  - identityToken sert à /me et /clients/me, qui exigent profile.read ;
    //  - billingToken sert au diagnostic de facturation, qui n'a besoin que de
    //    bills.read et transactions.read.
    // Les faire porter par la même variable obligerait le futur jeton dédié à
    // la facturation à détenir profile.read pour que le test passe — exactement
    // le privilège dont on veut se débarrasser. Chacun retombe sur l'autre
    // quand il manque, pour que l'installation reste possible en une étape.
    // Seule la PROVENANCE du jeton de facturation est renvoyée, jamais aucune
    // valeur.
    const tokenBilling = Deno.env.get("PROGBAT_BILLING_ACCESS_TOKEN") || ""
    const tokenLegacy = Deno.env.get("PROGBAT_PRIVATE_ACCESS_TOKEN") || ""
    const identityToken = tokenLegacy || tokenBilling
    const billingToken = tokenBilling || tokenLegacy
    const tokenSource: "billing" | "legacy" = tokenBilling ? "billing" : "legacy"
    if (!identityToken && !billingToken) {
      console.warn("[progbat-test-connection] aucun secret ProGBat configuré")
      return json({ ok: false, progbat_status: null, error: "Aucun secret ProGBat configuré dans Supabase (PROGBAT_BILLING_ACCESS_TOKEN ou PROGBAT_PRIVATE_ACCESS_TOKEN)." }, 500)
    }

    // ── 3. GET /me : valide le jeton et le scope profile.read ────────────────
    const me = await progbatGet("/me", identityToken, "profile.read")
    if (!me.ok) {
      console.warn(`[progbat-test-connection] appelant=${caller.id} /me → HTTP ${me.status} (${Date.now() - t0} ms)`)
      return json({ ok: false, progbat_status: me.status, token_source: tokenSource, error: me.message }, 200)
    }
    const m = (me.data ?? {}) as Record<string, unknown>
    const utilisateur = {
      prenom: typeof m.firstname === "string" ? m.firstname : "",
      nom: typeof m.lastname === "string" ? m.lastname : "",
      email: typeof m.email === "string" ? m.email : "",
    }

    // ── 4. GET /clients/me : nom de l'entreprise (scope profile) ─────────────
    // Facultatif : si le jeton n'a que profile.read, ProGBat peut répondre 403 ;
    // le test du jeton reste alors réussi, l'entreprise est simplement inconnue.
    const co = await progbatGet("/clients/me", identityToken, "profile ou company-accounts.read")
    let entreprises: { id: number | string | null; nom: string }[] = []
    let entrepriseMessage = ""
    if (co.ok) {
      const liste = Array.isArray(co.data) ? co.data : (co.data ? [co.data] : [])
      entreprises = liste.map((c: Record<string, unknown>) => ({
        id: (typeof c.id === "number" || typeof c.id === "string") ? c.id : null,
        nom: String(c.businessName || c.legalName || "").trim(),
      }))
    } else {
      entrepriseMessage = co.message
    }

    // ── 5. Diagnostic « facturation » — factures, règlements, PDF ───────────
    // Purement diagnostique : trois GET au plus (+ une reprise sans tri), aucune
    // écriture nulle part. Un échec ici n'invalide JAMAIS le résultat de /me :
    // chaque bloc porte son propre statut et son propre message.

    // 5a. Factures
    const fact = await listerProgbat("/company/bills", '{"documentDate":-1}', 20, billingToken, "bills.read")
    const facturesBrutes = fact.r.ok && Array.isArray(fact.r.data) ? fact.r.data as Record<string, unknown>[] : []
    const echantillonFactures = facturesBrutes.map(projeterFacture)
    const blocFactures = {
      ok: fact.r.ok,
      http_status: fact.r.status,
      scope_accessible: scopeAccessible(fact.r),
      content_range: fact.r.contentRange,          // null = en-tête absent
      tri_applique: fact.tri_applique,
      tri_refuse: fact.tri_refuse,
      nombre_recu: echantillonFactures.length,
      valeurs_distinctes: {
        type: valeursDistinctes(echantillonFactures.map(f => f.type)),
        status: valeursDistinctes(echantillonFactures.map(f => f.status)),
        validated: valeursDistinctes(echantillonFactures.map(f => f.validated)),
        einvoiceStatus: valeursDistinctes(echantillonFactures.map(f => f.einvoiceStatus)),
      },
      echantillon: echantillonFactures,
      ...(fact.r.ok ? {} : { message: fact.r.message }),
    }

    // 5b. Règlements (transactions bancaires + leur lettrage)
    const tr = await listerProgbat("/company/transactions", '{"date":-1}', 50, billingToken, "transactions.read")
    const transactionsBrutes = tr.r.ok && Array.isArray(tr.r.data) ? tr.r.data as Record<string, unknown>[] : []
    const echantillonTransactions = transactionsBrutes.map(projeterTransaction)
    const toutLeChecking = echantillonTransactions.flatMap(t => t.checking)
    const blocTransactions = {
      ok: tr.r.ok,
      http_status: tr.r.status,
      scope_accessible: scopeAccessible(tr.r),
      content_range: tr.r.contentRange,
      tri_applique: tr.tri_applique,
      tri_refuse: tr.tri_refuse,
      nombre_recu: echantillonTransactions.length,
      valeurs_distinctes: {
        canceled: valeursDistinctes(echantillonTransactions.map(t => t.canceled)),
        checked: valeursDistinctes(echantillonTransactions.map(t => t.checked)),
        checking_docType: valeursDistinctes(toutLeChecking.map(c => c.docType)),
      },
      echantillon: echantillonTransactions,
      ...(tr.r.ok ? {} : { message: tr.r.message }),
    }

    // 5c. Croisement facture ↔ règlement — CONSTAT, pas déduction.
    // Un lettrage n'est retenu que si son docId correspond EXACTEMENT à l'id
    // d'une facture de l'échantillon. Le docType correspondant est rapporté tel
    // quel : rien ici ne présume qu'un libellé de docType signifie « facture ».
    const parIdFacture = new Map<string, Record<string, unknown>>()
    for (const f of echantillonFactures) {
      const k = cleId(f.id)
      if (k) parIdFacture.set(k, f)
    }
    const facturesVues = new Set<string>()
    const docTypesCorrespondants = new Set<string>()
    const exemples: Record<string, unknown>[] = []
    let allocations = 0
    for (const t of echantillonTransactions) {
      for (const c of t.checking) {
        const k = cleId(c.docId)
        if (!k || !parIdFacture.has(k)) continue
        const f = parIdFacture.get(k)!
        allocations++
        facturesVues.add(k)
        if (c.docType != null) docTypesCorrespondants.add(String(c.docType))
        if (exemples.length < 10) {
          exemples.push({
            bill_id: f.id, bill_code: f.code,
            transaction_id: t.id, transaction_date: t.date,
            allocation_amount: c.amount, doc_type: c.docType,
          })
        }
      }
    }
    const blocCroisement = {
      factures_referencees: facturesVues.size,
      allocations_trouvees: allocations,
      doc_types_correspondants: [...docTypesCorrespondants],
      exemples,
    }

    // 5d. PDF — seulement si une facture SEMBLE validée, au sens littéral du
    // champ `validated` (entier non nul). La signification de cet entier reste
    // inconnue : le critère retenu est donc renvoyé avec le résultat, pour que
    // le lecteur juge lui-même.
    const candidate = echantillonFactures.find(f => {
      const v = typeof f.validated === "number" ? f.validated : Number(f.validated)
      return Number.isFinite(v) && v !== 0
    }) ?? null
    const blocPdf = candidate
      ? { ...(await testerPdfFacture(candidate.id, billingToken)), critere: "première facture de l'échantillon dont validated ≠ 0" }
      : {
          teste: false, bill_id: null, http_status: null, content_type: null,
          taille_octets: null, ok: null,
          message: blocFactures.ok
            ? "Aucune facture de l'échantillon n'a validated ≠ 0 : test PDF non effectué."
            : "Liste des factures inaccessible : test PDF non effectué.",
        }

    // 5e. Détail financier de 4 factures représentatives au maximum.
    // Un GET par facture retenue, jamais plus de quatre, chacun isolé : une
    // facture illisible n'empêche ni les autres, ni le reste du diagnostic.
    const aDetailler = choisirFacturesADetailler(echantillonFactures)
    const detailsFactures: Record<string, unknown>[] = []
    for (const { id, critere } of aDetailler) {
      const d = await progbatGet(`/company/bills/${encodeURIComponent(String(id))}`, billingToken, "bills.read")
      if (d.ok && d.data && typeof d.data === "object") {
        detailsFactures.push({
          critere, ok: true, http_status: d.status,
          ...projeterDetailFacture(d.data as Record<string, unknown>),
        })
      } else {
        detailsFactures.push({
          critere, ok: false, http_status: d.status, id,
          message: d.ok ? "Réponse ProGBat vide ou inattendue." : d.message,
        })
      }
    }
    const blocDetails = {
      ok: detailsFactures.every((d) => d.ok === true),
      nombre: detailsFactures.length,
      echantillon: detailsFactures,
      ...(aDetailler.length === 0
        ? { message: blocFactures.ok
            ? "Aucune facture de l'échantillon ne correspond aux critères (aucun brouillon n'est retenu)."
            : "Liste des factures inaccessible : aucun détail demandé." }
        : {}),
    }

    // Journal : comptages et codes HTTP uniquement — aucun identifiant ProGBat,
    // aucun montant, aucun jeton, aucun corps de réponse.
    console.log(
      `[progbat-test-connection] appelant=${caller.id} jeton=${tokenSource} ` +
      `/me → ${me.status}, /clients/me → ${co.status}, ` +
      `/company/bills → ${fact.r.status} (${blocFactures.nombre_recu}), ` +
      `/company/transactions → ${tr.r.status} (${blocTransactions.nombre_recu}), ` +
      `croisements=${allocations}, pdf=${blocPdf.teste ? blocPdf.http_status : "non testé"}, ` +
      `details=${blocDetails.nombre} ` +
      `(${Date.now() - t0} ms)`,
    )

    return json({
      ok: true,
      progbat_status: me.status,
      message: "Connexion ProGBat réussie : le jeton privé est valide.",
      token_source: tokenSource,
      utilisateur,
      entreprise: entreprises[0] ?? null,
      entreprises,
      entreprise_status: co.status,
      ...(entrepriseMessage ? { entreprise_message: entrepriseMessage } : {}),
      billing: {
        factures: blocFactures,
        transactions: blocTransactions,
        croisement: blocCroisement,
        pdf: blocPdf,
        details_factures: blocDetails,
      },
    })
  } catch (err) {
    console.error(`[progbat-test-connection] erreur interne : ${nettoyerMessage((err as Error)?.message)}`)
    return json({ ok: false, error: "Erreur interne du test de connexion." }, 500)
  }
})
