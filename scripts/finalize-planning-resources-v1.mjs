#!/usr/bin/env node
import fs from "node:fs";

function replaceExact(source, from, to, label) {
  if (source.includes(to)) return source;
  const n = source.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: motif attendu 1 fois, trouvé ${n}`);
  return source.replace(from, to);
}

// 1) Admin : toute sauvegarde d'équipe réaligne les IDs stables sur les noms.
{
  const path = "src/Renovation/Admin.jsx";
  let s = fs.readFileSync(path, "utf8");
  const from = `  const saveEquipes = async (next) => {
    setEquipes(next);
    await saveConfig("equipes", { items: next });
  };
`;
  const to = `  const saveEquipes = async (next) => {
    setEquipes(next);
    let items = next;
    try {
      const noms = [...new Set((next || []).flatMap(eq => [
        eq?.responsable,
        ...(eq?.membres || []).map(m => m?.ouvrier),
      ]).filter(Boolean))];
      if (noms.length) {
        const { data, error } = await supabase.from("planning_resources")
          .select("id,nom_planning")
          .in("nom_planning", noms);
        if (error) throw error;
        const byName = new Map((data || []).map(r => [String(r.nom_planning || "").trim().toLocaleLowerCase("fr-FR"), r.id]));
        items = (next || []).map(eq => {
          if (eq?.externe) return { ...eq, responsable_resource_id: null, membres: eq.membres || [] };
          const respKey = String(eq?.responsable || "").trim().toLocaleLowerCase("fr-FR");
          return {
            ...eq,
            responsable_resource_id: byName.get(respKey) || null,
            membres: (eq?.membres || []).map(m => ({
              ...m,
              resource_id: byName.get(String(m?.ouvrier || "").trim().toLocaleLowerCase("fr-FR")) || null,
            })),
          };
        });
        setEquipes(items);
      }
    } catch (e) {
      console.warn("Alignement resource_id équipes impossible, noms conservés :", e?.message || e);
    }
    await saveConfig("equipes", { items });
  };
`;
  s = replaceExact(s, from, to, "saveEquipes IDs stables");
  fs.writeFileSync(path, s);
}

// 2) CellModal : rendre la capacité ressource visible dans le cumul du jour.
{
  const path = "src/Renovation/CellModal.jsx";
  let s = fs.readFileSync(path, "utf8");
  const from1 = `                    const h=Math.round((ici+ailleurs)*4)/4;
                    // Rouge : dépasse la journée ; vert : journée pleine pile.
                    const colH=h>capaciteJour?"#ef4444":h===capaciteJour?"#22c55e":(h>0?T.text:T.textMuted);
`;
  const to1 = `                    const h=Math.round((ici+ailleurs)*4)/4;
                    const cap=capacitePourOuvrier(o);
                    const capaciteReduite=cap<capaciteJour;
                    // Rouge : dépasse la capacité réelle ; vert : capacité pleine pile.
                    const colH=h>cap?"#ef4444":h===cap&&cap>0?"#22c55e":(h>0?T.text:T.textMuted);
`;
  s = replaceExact(s, from1, to1, "calcul affichage capacité");

  const from2 = `                        <span style={{color:colH,fontWeight:800}}>{h}h</span>
                        {ailleurs>0&&(
`;
  const to2 = `                        <span style={{color:colH,fontWeight:800}}>{h}h / {cap}h</span>
                        {capaciteReduite&&(
                          <span style={{color:cap<=0?"#ef4444":"#f59e0b",fontSize:10.5,fontWeight:800}}>
                            {cap<=0?"indisponible":"capacité réduite"}
                          </span>
                        )}
                        {ailleurs>0&&(
`;
  s = replaceExact(s, from2, to2, "libellé capacité visible");
  fs.writeFileSync(path, s);
}

console.log("Finalisation Ressources V1 appliquée");
