// Crochet de chargement : `node --import ./scripts/_comparaison-moteur/crochet.mjs script.mjs`
// Toute importation de src/Renovation/planningEngineV1.js (par un test ou par un
// module de la chaîne) est redirigée vers enveloppe.mjs, qui appelle le moteur
// actuel ET la copie figée de référence, puis compare les deux sorties.
import { register } from "node:module";

register("./resolveur.mjs", import.meta.url);
