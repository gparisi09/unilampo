import { json, aiAccesa } from "../lib/base.mjs";
import { MAX_FONTI_PER_ARGOMENTO, MAX_CARATTERI_APPUNTI } from "../lib/regole.mjs";
import { chiavePubblica } from "../lib/avvisi.mjs";

// Stato pubblico per l'app: solo se il generatore è attivo. Costi e regole sono solo nel pannello.
export default async () => json({ accesa: await aiAccesa(), maxFonti: MAX_FONTI_PER_ARGOMENTO, maxCaratteri: MAX_CARATTERI_APPUNTI, vapid: chiavePubblica() });
export const config = { path: "/api/stato" };
