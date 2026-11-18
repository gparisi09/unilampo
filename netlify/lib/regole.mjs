// Regole di costo di UniLampo. Tutto quello che può far spendere soldi è deciso qui, nel codice.
//
// Listino Anthropic in dollari per milione di token (platform.claude.com, pricing, ottobre 2026):
//   Claude Haiku 5.5  · prompt fino a 100.000 token: 0,10 in · 0,50 out · lettura cache 0,01
//   Claude Sonnet 5.5 · 2 in · 10 out · lettura cache 0,10 · scrittura cache 5 minuti 2,50
// Ricerca web (strumento web_search): 10 dollari ogni 1.000 ricerche, più i token dei risultati.
// Se Anthropic cambia i prezzi, si aggiornano solo questi numeri.

export const PREZZI = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, cacheR: 0.01, cacheW: 0.125 },
  "claude-sonnet-5-5": { in: 2.00, out: 10.00, cacheR: 0.10, cacheW: 2.50 },
};
export const PREZZO_RICERCA = 0.01; // dollari per ricerca web

// Modello economico dove basta, quello costoso solo per scrivere la dispensa.
export const ECONOMICO = "claude-haiku-5-5";
export const COSTOSO = "claude-sonnet-5-5";

// Tetto di spesa giornaliero (dollari, perché Anthropic fattura in dollari). Dal pannello si può alzare solo per oggi.
// Arrivati qui, la generazione si ferma fino a domani. Il limite mensile è quello impostato nella console Anthropic.
export const TETTO_GIORNO = 3.0;

// Ricerca web: argomenti per caricamento, ricerche e fonti per argomento.
export const MAX_ARGOMENTI = 6;
export const RICERCHE_PER_ARGOMENTO = 1;
export const MAX_FONTI_PER_ARGOMENTO = 3;
export const RICERCHE_APPROFONDISCI = 1;

// Appunti: oltre questa lunghezza si tagliano (tiene il prompt sotto la soglia dei prezzi più alti).
export const MAX_CARATTERI_APPUNTI = 60000;

// Token massimi in uscita per ogni passaggio (fanno anche da base della stima).
// Margine ampio: si pagano solo i token davvero scritti, e una risposta tagliata a metà sarebbe illeggibile.
export const USCITA = { argomenti: 1200, ricerca: 1800, capitolo: 2600, mappa: 1000, domande: 3200, approfondisci: 2200, orale: 900 };

// Stima dei token in ingresso che non dipendono dagli appunti (istruzioni, fonti, risultati della ricerca).
export const INGRESSO_FISSO = { argomenti: 500, ricerca: 1500, capitolo: 2500, mappa: 3000, domande: 3500, approfondisci: 3500, orale: 1500 };
export const TOKEN_PER_RICERCA = 7000; // i risultati di una ricerca web entrano nel prompt: stima prudente

export const CARATTERI_PER_TOKEN = 3; // prudente per l'italiano

// Siti che non sono fonti affidabili per lo studio universitario.
export const DOMINI_ESCLUSI = ["skuola.net", "studenti.it", "docsity.com", "studocu.com", "appunti.net", "wikihow.com", "quora.com", "reddit.com", "youtube.com", "tiktok.com", "facebook.com", "instagram.com", "brainly.com", "brainly.it"];

export function costoDaUso(modello, u, ricerche = 0) {
  const p = PREZZI[modello] || PREZZI[ECONOMICO];
  u = u || {};
  const usd = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cacheR + (u.cache_creation_input_tokens || 0) * p.cacheW) / 1e6 + ricerche * PREZZO_RICERCA;
  return Math.round(usd * 1e5) / 1e5;
}

// Stima massima di un passaggio: ingresso stimato + uscita massima + ricerche.
export function stimaPassaggio(passo, { caratteri = 0, ricerche = 0, cacheLetta = false } = {}) {
  const modello = passo === "capitolo" || passo === "mappa" ? COSTOSO : ECONOMICO;
  const p = PREZZI[modello];
  const tokAppunti = Math.ceil(caratteri / CARATTERI_PER_TOKEN);
  const fisso = INGRESSO_FISSO[passo] + ricerche * TOKEN_PER_RICERCA;
  const prezzoAppunti = modello === COSTOSO ? (cacheLetta ? p.cacheR : p.cacheW) : p.in; // solo la dispensa usa la cache
  const ingresso = tokAppunti * prezzoAppunti + fisso * p.in;
  const usd = (ingresso + USCITA[passo] * p.out) / 1e6 + ricerche * PREZZO_RICERCA;
  return { modello, usd: Math.round(usd * 1e5) / 1e5 };
}
export const EXTRA_MAX_GIORNO = 3; // dollari in più che il pannello può aggiungere in un giorno
