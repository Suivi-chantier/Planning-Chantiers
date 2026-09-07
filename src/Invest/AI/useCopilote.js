// src/Invest/AI/useCopilote.js — Le seul point d'appel du Copilote côté client.
//
// Aucun composant React ne parle à Anthropic : tout passe par /api/ai, où vit
// la clé API. Ce hook ne connaît ni modèle, ni fournisseur, ni outil — il
// envoie une question et reçoit une réponse structurée.
//
// Il ne réutilise pas la mécanique de PropositionIA du socle (§ 5.4) : ce
// composant n'a jamais été écrit, et le Copilote n'en a pas le besoin — il ne
// pré-remplit aucun champ, il répond à une question.

import { useCallback, useRef, useState } from "react";
import { supabase } from "../../supabase";

// Codes d'erreur normalisés par le socle (§ 3.3), traduits en messages
// lisibles. Un message technique dans une bulle de conversation n'aide
// personne à savoir quoi faire.
const MESSAGES = {
  non_authentifie: "Votre session a expiré. Reconnectez-vous pour utiliser Profero AI.",
  non_autorise: null, // le serveur explique déjà pourquoi : on garde son texte
  quota_depasse: "Le plafond d'utilisation de l'IA est atteint. Réessayez plus tard.",
  tache_inconnue: "Le Copilote n'est pas déployé sur ce serveur.",
  entree_invalide: "Question mal formée. Reformulez-la.",
  sortie_invalide: "Le modèle n'a pas su répondre dans le format attendu. Reformulez la question.",
  modele_indisponible:
    "Profero AI est momentanément indisponible. L'application reste utilisable normalement.",
  erreur_interne: "Une erreur est survenue côté serveur.",
};

export function useCopilote() {
  const [enCours, setEnCours] = useState(false);
  const [echanges, setEchanges] = useState([]); // { question, reponse, blocs, absente, erreur }
  const enVol = useRef(false);

  const reinitialiser = useCallback(() => setEchanges([]), []);

  const demander = useCallback(async (question, contexte) => {
    const q = String(question || "").trim();
    if (!q || enVol.current) return;

    enVol.current = true;
    setEnCours(true);
    // La question apparaît immédiatement : l'attente doit se voir sur la
    // question posée, pas sur un écran vide.
    setEchanges((prev) => [...prev, { question: q, enAttente: true }]);

    const remplacer = (patch) =>
      setEchanges((prev) => {
        const suite = [...prev];
        suite[suite.length - 1] = { question: q, ...patch };
        return suite;
      });

    try {
      const { data: session } = await supabase.auth.getSession();
      const jeton = session?.session?.access_token;
      if (!jeton) {
        remplacer({ erreur: MESSAGES.non_authentifie });
        return;
      }

      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}` },
        body: JSON.stringify({
          tache: "invest_copilot",
          entree: { question: q },
          contexte: { branche: "invest", ...(contexte || {}) },
        }),
      });

      const corps = await r.json().catch(() => null);

      if (!r.ok || !corps || corps.ok !== true) {
        const code = corps?.erreur?.code;
        const message =
          (code && MESSAGES[code]) ||
          corps?.erreur?.message ||
          `Erreur ${r.status}`;
        remplacer({ erreur: message });
        return;
      }

      remplacer({
        reponse: corps.resultat?.reponse || "",
        absente: corps.resultat?.donnee_absente === true,
        // Les blocs viennent du serveur, collectés depuis les sorties d'outils.
        // Le modèle ne les fabrique pas : l'interface ne peut donc afficher
        // que des données réellement lues en base.
        blocs: Array.isArray(corps.blocs) ? corps.blocs : [],
        outils: Array.isArray(corps.outils_utilises) ? corps.outils_utilises : [],
        meta: corps.meta || null,
      });
    } catch (e) {
      remplacer({ erreur: `Appel impossible : ${e.message}` });
    } finally {
      enVol.current = false;
      setEnCours(false);
    }
  }, []);

  return { echanges, enCours, demander, reinitialiser };
}
