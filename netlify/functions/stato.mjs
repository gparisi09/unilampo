import { json, aiAccesa, chiavePropria, spesaOggi } from "../lib/base.mjs";
import * as R from "../lib/regole.mjs";

// Stato dell'AI e regole di costo: l'app le usa per mostrare la stima prima di ogni generazione.
export default async () => {
  const g = await spesaOggi();
  return json({
    accesa: await aiAccesa(), chiave: chiavePropria(), pin: !!process.env.UNILAMPO_PIN,
    speso: g.usd, tetto: R.TETTO_GIORNO,
    regole: {
      PREZZI: R.PREZZI, PREZZO_RICERCA: R.PREZZO_RICERCA, ECONOMICO: R.ECONOMICO, COSTOSO: R.COSTOSO,
      MAX_ARGOMENTI: R.MAX_ARGOMENTI, RICERCHE_PER_ARGOMENTO: R.RICERCHE_PER_ARGOMENTO, MAX_FONTI_PER_ARGOMENTO: R.MAX_FONTI_PER_ARGOMENTO,
      RICERCHE_APPROFONDISCI: R.RICERCHE_APPROFONDISCI, MAX_CARATTERI_APPUNTI: R.MAX_CARATTERI_APPUNTI,
      USCITA: R.USCITA, INGRESSO_FISSO: R.INGRESSO_FISSO, TOKEN_PER_RICERCA: R.TOKEN_PER_RICERCA, CARATTERI_PER_TOKEN: R.CARATTERI_PER_TOKEN,
    },
  });
};
export const config = { path: "/api/stato" };
