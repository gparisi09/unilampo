# UniLampo · beta

Dai tuoi appunti universitari a dispense con mappe, fonti verificate, test a crocette e orale con la commissione.
Progetto separato da Bandolampo: stesso modo di lavorare, codice copiato e non condiviso.

- `public/` è l'app (HTML, CSS, JavaScript). I PDF si leggono sul telefono.
- `netlify/functions/` sono le funzioni: stato, interruttore AI, dati, caricamento appunti, generazione.
- `netlify/lib/regole.mjs` contiene **tutte le regole di costo**: listino, modelli, tetto giornaliero, fonti massime.

## Variabili da impostare su Netlify

| Variabile | A cosa serve |
|---|---|
| `ANTHROPIC_API_KEY` | La tua chiave Anthropic (workspace UniLampo, con limite mensile nella console). Obbligatoria per l'AI. |
| `UNILAMPO_PIN` | PIN per accendere e spegnere il generatore AI dall'app. Senza PIN l'AI resta spenta. |

L'AI usa sempre e solo la tua chiave: l'AI Gateway di Netlify non viene mai usato.

## Regole di costo

- Generatore AI **spento di default**; si accende dalle impostazioni dell'app con il PIN.
- Tetto di spesa giornaliero nel codice (`TETTO_GIORNO`, in dollari): raggiunto, la generazione si ferma fino a domani.
- Dispensa, ricerca e domande si generano una volta per caricamento e restano salvate; ogni "Approfondisci" una volta sola.
- Modello economico (Haiku 5.5) per argomenti, ricerca, domande, approfondimenti e orale; modello avanzato (Sonnet 5.5) solo per scrivere dispensa e mappa.
- Ricerca web: massimo 2 ricerche e 3 fonti per argomento; le fonti sono solo indirizzi restituiti davvero dalla ricerca.
- Prima di ogni generazione l'app mostra la stima massima del costo.
- Voce della commissione: quella del telefono (gratis).
