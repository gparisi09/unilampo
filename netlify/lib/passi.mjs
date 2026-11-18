import { store, json, uidOk, idOk, sha, aiAccesa, puoSpendere, registraSpesa } from "./base.mjs";
import { chiedi, leggiJSON } from "./claude.mjs";
import { assembla, leggiMeta, salvaMeta, salvaPezzo } from "./dispensa.mjs";
import { fetta, numeroPagine } from "./pagine.mjs";
import { ECONOMICO, COSTOSO, USCITA, MAX_ARGOMENTI, RICERCHE_PER_ARGOMENTO, MAX_FONTI_PER_ARGOMENTO, RICERCHE_APPROFONDISCI, stimaPassaggio } from "./regole.mjs";

// Un passaggio di generazione per chiamata.
// Ogni risultato si salva: la seconda volta si rilegge e non costa nulla.

const s = (v, n = 600) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const lista = (v, n, m = 400) => (Array.isArray(v) ? v.slice(0, n).map((x) => s(x, m)).filter(Boolean) : []);
const normUrl = (u) => String(u || "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

const MARCATORI = `Usa questi segni nel testo, con misura (al massimo 2-3 per paragrafo):
[[g|parole]] concetto chiave (evidenziato in giallo)
[[c|parole]] definizione (evidenziata in celeste)
[[r|parole]] attenzione, errore frequente (evidenziato in rosa)
[[u|parole]] formula o regola da sapere a memoria (sottolineata)
Per citare una fonte scrivi il suo numero tra parentesi quadre, es. [2]. Per citare una pagina degli appunti scrivi [p.12] (o [p.12-13]).
Non usare HTML, asterischi o markdown.`;

const FORMATO = `Formato della risposta: SOLO un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice. Dentro i testi non usare mai le virgolette doppie ": per le citazioni usa « » oppure l'apostrofo.`;

const ONESTA = `Regole di onestà, obbligatorie:
- Non inventare dati, numeri, date, autori, articoli di legge o fonti.
- Ogni informazione presa dalle fonti va citata con il suo numero; ogni informazione presa dagli appunti cita la sua pagina, es. [p.7] (le pagine sono segnate nel testo come [[PAGINA 7]]).
- Se appunti e fonti non bastano per dire qualcosa con sicurezza, non dirlo.`;

const P = {
  argomenti: `Sei un tutor universitario italiano. Ricevi gli appunti (o la dispensa) di una studentessa per una materia. Il testo è diviso in pagine segnate così: [[PAGINA 7]].
Dividi TUTTO il testo in argomenti, nell'ordine in cui compaiono, come i capitoli di un libro:
- copri ogni pagina dalla prima all'ultima, senza saltarne nessuna: ogni pagina deve stare in un argomento;
- un argomento ogni 2-3 pagine circa: il numero giusto è indicato sotto; segui i titoli e i cambi di tema del testo;
- per ognuno: titolo, una frase che dice cosa contiene, pagina di inizio ("da") e di fine ("a");
- non aggiungere argomenti che nel testo non ci sono.
Rispondi SOLO con JSON: {"titolo": "titolo breve della lezione o del documento", "argomenti": [{"titolo": "...", "descrizione": "una frase", "da": 1, "a": 3}]}`,

  ricerca: `Sei un ricercatore che verifica appunti universitari. Cerca sul web fonti AFFIDABILI sull'argomento indicato, nell'ambito della materia indicata.
Fonti valide, in ordine di preferenza: manuali e dispense universitarie, pagine di università, enciclopedie (es. Treccani, Britannica, Stanford Encyclopedia of Philosophy), siti istituzionali, articoli scientifici o di riviste accademiche. Evita blog, forum, siti di appunti condivisi, contenuti commerciali.
Scegli al massimo ${MAX_FONTI_PER_ARGOMENTO} fonti tra quelle che hai davvero trovato con la ricerca: copia l'indirizzo esatto.
Per ogni fonte riporta da 2 a 4 punti brevi (massimo 20 parole): cosa dice di utile sull'argomento, con parole tue, fedeli alla fonte. Niente che la fonte non dica.
Rispondi SOLO con JSON: {"fonti": [{"url": "...", "titolo": "...", "sito": "nome del sito", "tipo": "manuale|università|enciclopedia|istituzionale|articolo", "punti": ["..."]}]}`,

  capitolo: `Sei un docente universitario italiano che scrive una dispensa di studio chiara e FEDELE, a partire dalle pagine degli appunti della studentessa e dalle fonti verificate che ricevi.
Scrivi il capitolo sull'argomento indicato, usando TUTTE le pagine che ricevi:
- ogni concetto, definizione, elenco, autore, data o formula presente in quelle pagine deve comparire: non tagliare parti;
- da 3 a 7 paragrafi (al massimo 90 parole ciascuno): più pagine e più concetti, più paragrafi;
- spiega in modo semplice ma da livello universitario; parti dagli appunti e cita la pagina [p.N]; usa le fonti per completare, correggere e confermare, citandole [N];
- un esempio concreto, una trappola (errore tipico all'esame), una cosa da ricordare: al massimo 35 parole ciascuno;
- confronta appunti e fonti in al massimo 3 voci brevi (25 parole): cosa coincide ("ok"), cosa manca negli appunti ("incompleto"), cosa negli appunti è diverso dalle fonti ("diverso"). Ogni voce cita pagina e fonte.
${MARCATORI}
${ONESTA}
Rispondi SOLO con JSON: {"titolo": "...", "paragrafi": ["..."], "esempio": "...", "trappola": "...", "ricorda": "...", "confronto": [{"tipo": "ok|incompleto|diverso", "testo": "..."}], "collegati": ["titoli di altri argomenti dell'elenco collegati a questo"]}`,

  mappa: `Ricevi i capitoli di una dispensa universitaria. Crea una mappa concettuale.
Rendila COMPLETA e da studio: deve bastare da sola per ripassare tutto l'argomento.
- "centro": il tema in massimo 5 parole; "sottotitolo": una riga che dice di cosa parla.
- da 4 a 6 rami, i concetti principali, nell'ordine in cui conviene studiarli. Ogni ramo ha:
  "titolo" (massimo 5 parole); "testo" (massimo 22 parole) che spiega il concetto e usa i segni: [[g|concetto chiave]], [[c|definizione]], [[r|trappola o errore tipico]], [[u|formula o dato da ricordare]], almeno un segno per ramo;
  "foglie": da 2 a 4 sotto-punti da sapere (massimo 9 parole ciascuno: elementi, tipi, esempi, eccezioni, autori, date);
  "capitolo": il numero del capitolo/argomento a cui rimanda.
- "collegamenti": da 1 a 3 legami tra rami diversi, {"da": numero ramo, "a": numero ramo, "perche": massimo 12 parole}.
Rispondi SOLO con JSON: {"centro": "...", "sottotitolo": "...", "rami": [{"titolo": "...", "testo": "...", "foglie": ["..."], "capitolo": 1}], "collegamenti": [{"da": 1, "a": 2, "perche": "..."}]}`,

  domande: `Sei un docente universitario che prepara l'esame. Dal capitolo che ricevi crea:
- 6 domande a crocette con 4 alternative brevi (massimo 12 parole), una sola giusta, alternative sbagliate plausibili; per ognuna una spiegazione di massimo 30 parole;
- 2 domande per l'orale, ognuna con 3-4 punti chiave brevi (massimo 10 parole) che una risposta completa deve toccare.
Le domande devono basarsi solo su ciò che il capitolo dice. Nel campo "fonte" metti il numero della fonte tra parentesi quadre se l'informazione viene da una fonte, altrimenti "appunti".
Rispondi SOLO con JSON: {"crocette": [{"testo": "...", "opzioni": ["...","...","...","..."], "giusta": 0, "spiegazione": "...", "fonte": "[1]"}], "orali": [{"domanda": "...", "punti": ["..."]}]}`,

  approfondisci: `Sei un docente universitario. La studentessa ha toccato "Approfondisci" su una parte della sua dispensa. Spiegala più a fondo:
- 2-3 paragrafi di spiegazione più profonda (massimo 80 parole ciascuno);
- 1-2 esempi concreti;
- collegamenti con altri argomenti della stessa materia (scegli solo dall'elenco che ricevi, se pertinenti);
- 3 domande a crocette su questo approfondimento, con spiegazione.
Puoi fare una ricerca web se serve una fonte in più: usa solo fonti affidabili (manuali, università, enciclopedie, siti istituzionali, articoli scientifici).
Per citare usa i numeri delle fonti già note [n]; per una fonte nuova trovata con la ricerca, scrivi [N1] e mettila in "nuove".
${MARCATORI}
${ONESTA}
Rispondi SOLO con JSON: {"titolo": "...", "paragrafi": ["..."], "esempi": ["..."], "collegamenti": ["..."], "nuove": [{"url": "...", "titolo": "..."}], "crocette": [{"testo": "...", "opzioni": ["...","...","...","..."], "giusta": 0, "spiegazione": "...", "fonte": "[1]"}]}`,

  domandeT: `Sei un docente universitario che prepara l'esame. Ricevi un testo di studio già pronto (appunti o dispensa) e un argomento.
Usando SOLO la parte del testo che riguarda quell'argomento, crea:
- 6 domande a crocette con 4 alternative brevi (massimo 12 parole), una sola giusta, alternative sbagliate plausibili; per ognuna una spiegazione di massimo 30 parole;
- 2 domande per l'orale, ognuna con 3-4 punti chiave brevi (massimo 10 parole).
Non aggiungere nulla che il testo non dica. Nel campo "fonte" scrivi "appunti".
Rispondi SOLO con JSON: {"crocette": [{"testo": "...", "opzioni": ["...","...","...","..."], "giusta": 0, "spiegazione": "...", "fonte": "appunti"}], "orali": [{"domanda": "...", "punti": ["..."]}]}`,

  mappaT: `Ricevi un testo di studio già pronto (appunti o dispensa) e l'elenco dei suoi argomenti. Crea una mappa concettuale fedele al testo: niente che il testo non dica.
Rendila COMPLETA e da studio: deve bastare da sola per ripassare tutto l'argomento.
- "centro": il tema in massimo 5 parole; "sottotitolo": una riga che dice di cosa parla.
- da 4 a 6 rami, i concetti principali, nell'ordine in cui conviene studiarli. Ogni ramo ha:
  "titolo" (massimo 5 parole); "testo" (massimo 22 parole) che spiega il concetto e usa i segni: [[g|concetto chiave]], [[c|definizione]], [[r|trappola o errore tipico]], [[u|formula o dato da ricordare]], almeno un segno per ramo;
  "foglie": da 2 a 4 sotto-punti da sapere (massimo 9 parole ciascuno: elementi, tipi, esempi, eccezioni, autori, date);
  "capitolo": il numero del capitolo/argomento a cui rimanda.
- "collegamenti": da 1 a 3 legami tra rami diversi, {"da": numero ramo, "a": numero ramo, "perche": massimo 12 parole}.
Rispondi SOLO con JSON: {"centro": "...", "sottotitolo": "...", "rami": [{"titolo": "...", "testo": "...", "foglie": ["..."], "capitolo": 1}], "collegamenti": [{"da": 1, "a": 2, "perche": "..."}]}`,

  orale: `Sei il presidente di una commissione d'esame universitario italiano. Conduci un orale breve su una domanda della materia indicata.
Parli A VOCE: frasi brevi, italiano parlato, niente elenchi né simboli.
Dopo ogni risposta della studentessa:
- se ha risposto meno di 3 volte e non ha detto di non sapere: commenta in una frase senza dare il voto, poi fai UNA domanda di approfondimento legata a ciò che ha detto o a ciò che manca (massimo 40 parole);
- altrimenti chiudi con una frase cortese e valuta.
Quando chiudi, valuti TU tutto il colloquio: per ogni punto chiave decidi se è stato toccato davvero nel merito (una citazione vaga o sbagliata non conta), e dai il voto in trentesimi (da 0 a 30; sotto 18 l'esame non è superato; 30 e lode solo per risposte complete, precise e ben argomentate).
Rispondi SOLO con JSON: {"battuta": "ciò che dici ad alta voce", "fine": true|false, "voto": intero o null, "lode": true|false, "punti": [true/false per ogni punto chiave], "bene": ["max 3 frasi"], "manca": ["max 3 frasi"], "consiglio": "una frase"}
Voto, lode, punti, bene, manca e consiglio vanno compilati solo quando "fine" è true.`,
};

const crocetteOk = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map((q) => ({
  testo: s(q && q.testo, 400),
  opzioni: lista(q && q.opzioni, 4, 200),
  giusta: Math.max(0, Math.min(3, Number(q && q.giusta) || 0)),
  spiegazione: s(q && q.spiegazione, 700),
  fonte: s(q && q.fonte, 30),
})).filter((q) => q.testo && q.opzioni.length === 4);

// Ogni pagina deve finire in un argomento: si ordinano gli intervalli e si chiudono i buchi.
// Un argomento senza pagine valide si appoggia al successivo; un argomento troppo lungo si divide in parti.
function coperturaCompleta(lista, nPag) {
  let a = lista.map((x) => ({ ...x, da: Math.max(1, Math.min(nPag, x.da || 0)), a: Math.max(1, Math.min(nPag, x.a || 0)) }))
    .map((x) => (x.a < x.da ? { ...x, a: x.da } : x)).sort((x, y) => x.da - y.da || x.a - y.a);
  if (!a.length) a = [{ titolo: "Appunti", descrizione: "", da: 1, a: nPag }];
  a[0].da = 1;
  for (let k = 1; k < a.length; k++) { if (a[k].da > a[k - 1].a + 1) a[k - 1].a = a[k].da - 1; if (a[k].da <= a[k - 1].a && a[k].a <= a[k - 1].a && a.length > 1) { /* contenuto in quello prima: va bene, si sovrappone */ } }
  a[a.length - 1].a = Math.max(a[a.length - 1].a, nPag);
  // nessun capitolo oltre 6 pagine: si divide (resta fedele, solo più capitoli)
  const out = [];
  for (const x of a) {
    const lung = x.a - x.da + 1, pezzi = Math.ceil(lung / 6);
    if (pezzi <= 1) { out.push(x); continue; }
    const passo = Math.ceil(lung / pezzi);
    for (let k = 0; k < pezzi; k++) { const da = x.da + k * passo, fine = Math.min(x.a, da + passo - 1); if (da <= fine) out.push({ titolo: `${x.titolo} (${k + 1}/${pezzi})`, descrizione: x.descrizione, da, a: fine }); }
  }
  return out.slice(0, 30);
}

// Esegue un passaggio e restituisce la risposta HTTP (la usano /api/genera e la preparazione in background).
export async function esegui(b) {
  const { uid, cid, passo } = b || {};
  if (!uidOk(uid) || !idOk(cid) || !P[passo]) return json({ error: "bad" }, 400);

  const cache = store("cache");
  const d = await assembla(uid, cid);
  if (!d) return json({ error: "nessun caricamento" }, 404);
  if (b.materia) d.materia = s(b.materia, 120); // il nome può essere stato cambiato nell'app
  const testo = (await store("testi").get(`${uid}/${cid}`).catch(() => null)) || "";
  const i = Math.max(0, Number(b.indice) || 0);

  // --- già pronto? Allora non si spende nulla.
  const salvato = passo === "argomenti" ? (d.argomenti && d.argomenti.length ? { titolo: d.titolo, argomenti: d.argomenti } : null)
    : passo === "ricerca" ? d.ricerca[i] : passo === "capitolo" ? d.capitoli[i] : passo === "mappa" ? d.mappa
    : passo === "domande" || passo === "domandeT" ? d.domande[i] : passo === "mappaT" ? d.mappa : passo === "approfondisci" ? d.approfondimenti[s(b.chiave, 80)] : null;
  if (salvato) return json({ ok: true, gia: true, usd: 0, dato: salvato });

  // --- interruttore e tetto
  if (!(await aiAccesa())) return json({ error: "spenta" }, 503);
  const arg = (d.argomenti || [])[i];
  if (["ricerca", "capitolo", "domande", "domandeT"].includes(passo) && !arg) return json({ error: "bad" }, 400);
  // i capitoli citano le fonti con numeri che valgono per tutta la dispensa: prima servono tutte le ricerche
  if (passo === "capitolo" && d.argomenti.some((a, k) => !d.ricerca[k])) return json({ error: "prima le fonti" }, 409);
  if (passo === "approfondisci" && !/^[a-z0-9]{1,20}$/.test(String(b.chiave || ""))) return json({ error: "bad" }, 400);
  const nPag = numeroPagine(testo) || 1;
  const pezzoDi = (a) => fetta(testo, a.da || 1, a.a || nPag);
  const suo = arg && (passo === "capitolo" || passo === "domandeT") ? pezzoDi(arg) : "";
  const testoMappa = testo.slice(0, 120000);
  const stima = stimaPassaggio(passo, {
    caratteri: passo === "argomenti" ? testo.length : passo === "mappaT" ? testoMappa.length : suo ? suo.length : 0,
    ricerche: passo === "ricerca" ? RICERCHE_PER_ARGOMENTO : passo === "approfondisci" ? RICERCHE_APPROFONDISCI : 0,
    cacheLetta: false,
  });
  const cap = await puoSpendere(stima.usd);
  if (!cap.ok) return json({ error: "tetto", speso: cap.speso, tetto: cap.tetto }, 429);

  // --- cache condivisa: stesso input, stessa risposta, nessuna spesa
  const fonti = d.fonti || [];
  const fontiTesto = (nums) => fonti.filter((f) => !nums || nums.includes(f.n)).map((f) => `[${f.n}] ${f.titolo} (${f.sito || f.url})\n${(f.punti || []).map((p) => "- " + p).join("\n")}`).join("\n\n") || "(nessuna fonte trovata)";
  const titoliArg = (d.argomenti || []).map((a, k) => `${k + 1}. ${a.titolo}` + (a.da ? ` (pp. ${a.da}-${a.a})` : "")).join("\n");
  let chiaveCache, chiamata;

  try {
    if (passo === "argomenti") {
      chiaveCache = "arg/" + (await sha(testo));
      const quanti = Math.max(2, Math.min(MAX_ARGOMENTI, Math.round(nPag / 2.5)));
      chiamata = { modello: ECONOMICO, istruzioni: P.argomenti, testo: `Materia: ${s(d.materia, 120)}\nPagine: da 1 a ${nPag}. Argomenti da individuare: circa ${quanti} (da ${Math.max(1, quanti - 2)} a ${Math.min(MAX_ARGOMENTI, quanti + 3)}).\n\nAPPUNTI:\n${testo}`, max: USCITA.argomenti };
    } else if (passo === "ricerca") {
      chiaveCache = "ric/" + (await sha(d.materia + "|" + arg.titolo + "|" + arg.descrizione));
      chiamata = { modello: ECONOMICO, istruzioni: P.ricerca, testo: `Materia: ${s(d.materia, 120)}\nArgomento: ${arg.titolo}\nDi cosa parla negli appunti: ${arg.descrizione}`, max: USCITA.ricerca, ricerche: RICERCHE_PER_ARGOMENTO };
    } else if (passo === "capitolo") {
      const mie = (d.ricerca[i] && d.ricerca[i].nums) || [];
      chiaveCache = "cap2/" + (await sha(suo + "|" + arg.titolo + "|" + JSON.stringify(mie.map((n) => fonti.find((f) => f.n === n)))));
      chiamata = { modello: COSTOSO, istruzioni: P.capitolo,
        testo: `Materia: ${s(d.materia, 120)}\nElenco degli argomenti della lezione:\n${titoliArg}\n\nScrivi il capitolo ${i + 1}: ${arg.titolo} (pagine ${arg.da}-${arg.a})\n\nPAGINE DEGLI APPUNTI PER QUESTO CAPITOLO:\n${suo}\n\nFONTI VERIFICATE PER QUESTO ARGOMENTO:\n${fontiTesto(mie)}`, max: USCITA.capitolo };
    } else if (passo === "mappa") {
      const caps = (d.argomenti || []).map((a, k) => d.capitoli[k] ? `${k + 1}. ${d.capitoli[k].titolo}: ${(d.capitoli[k].paragrafi || []).join(" ").slice(0, 600)}` : "").filter(Boolean).join("\n\n");
      if (!caps) return json({ error: "prima i capitoli" }, 400);
      chiaveCache = "map/" + (await sha(caps));
      chiamata = { modello: COSTOSO, istruzioni: P.mappa, testo: `Materia: ${s(d.materia, 120)}\n\nCAPITOLI:\n${caps}`, max: USCITA.mappa };
    } else if (passo === "domande") {
      const c = d.capitoli[i];
      if (!c) return json({ error: "prima il capitolo" }, 400);
      const corpo = [c.titolo, ...(c.paragrafi || []), "Esempio: " + c.esempio, "Trappola: " + c.trappola, "Da ricordare: " + c.ricorda].join("\n");
      chiaveCache = "dom/" + (await sha(corpo));
      chiamata = { modello: ECONOMICO, istruzioni: P.domande, testo: `Materia: ${s(d.materia, 120)}\n\nCAPITOLO:\n${corpo}\n\nFONTI:\n${fontiTesto()}`, max: USCITA.domande };
    } else if (passo === "domandeT") {
      chiaveCache = "domT2/" + (await sha(suo + "|" + arg.titolo));
      chiamata = { modello: ECONOMICO, istruzioni: P.domandeT, testo: `Materia: ${s(d.materia, 120)}\nArgomento: ${arg.titolo} (${arg.descrizione}), pagine ${arg.da}-${arg.a}\n\nTESTO DI QUESTE PAGINE:\n${suo}`, max: USCITA.domandeT };
    } else if (passo === "mappaT") {
      chiaveCache = "mapT2/" + (await sha(testoMappa + titoliArg));
      chiamata = { modello: ECONOMICO, istruzioni: P.mappaT, testo: `Materia: ${s(d.materia, 120)}\nArgomenti:\n${titoliArg}\n\nTESTO:\n${testoMappa}`, max: USCITA.mappaT };
    } else if (passo === "approfondisci") {
      const chiave = s(b.chiave, 80), parte = s(b.parte, 2500), cap = d.capitoli[Math.max(0, Number(b.capitolo) || 0)];
      if (!chiave || !parte) return json({ error: "bad" }, 400);
      const altri = lista(b.altri, 40, 160).join("\n") || "(nessuno)";
      chiaveCache = "app/" + (await sha(d.materia + "|" + parte));
      chiamata = { modello: ECONOMICO, istruzioni: P.approfondisci,
        testo: `Materia: ${s(d.materia, 120)}\n\nPARTE DA APPROFONDIRE:\n${parte}\n\nCAPITOLO IN CUI SI TROVA:\n${cap ? (cap.paragrafi || []).join("\n") : ""}\n\nALTRI ARGOMENTI DELLA MATERIA:\n${altri}\n\nFONTI GIÀ NOTE:\n${fontiTesto()}`,
        max: USCITA.approfondisci, ricerche: RICERCHE_APPROFONDISCI };
    } else if (passo === "orale") {
      const punti = lista(b.punti, 6, 200).map((x, k) => `${k + 1}. ${x}`).join("\n");
      const storia = (Array.isArray(b.storia) ? b.storia : []).slice(-8).map((m) => (m && m.chi === "studente" ? "STUDENTESSA: " : "COMMISSIONE: ") + s(m && m.testo, 1500)).join("\n");
      const n = (Array.isArray(b.storia) ? b.storia : []).filter((m) => m && m.chi === "studente").length;
      chiamata = { modello: ECONOMICO, istruzioni: P.orale, testo: `Materia: ${s(d.materia, 120)}\nDomanda: ${s(b.domanda, 400)}\nPunti chiave (non dirli):\n${punti}\nRisposte finora: ${n}\n\nSCAMBIO:\n${storia}`, max: USCITA.orale };
    }

    let out = chiaveCache ? await cache.get(chiaveCache, { type: "json" }).catch(() => null) : null, usd = 0;
    if (!out) {
      chiamata.istruzioni += "\n\n" + FORMATO;
      // Se la risposta è troppo lunga o non leggibile, si riprova da soli una volta chiedendo testi più corti.
      let r = await chiedi(chiamata), o = null;
      usd = r.usd; await registraSpesa(passo, r.usd, r.ricerche);
      try { o = leggiJSON(r.text); } catch {}
      if (!o) {
        console.error("riprovo più corto", passo, r.stop, r.text.slice(0, 300));
        const corta = { ...chiamata, modello: ECONOMICO, cache: false, ricerche: 0, max: Math.round(chiamata.max * 1.5),
          istruzioni: chiamata.istruzioni + "\n\nIMPORTANTE: la risposta precedente era troppo lunga o non valida. Sii molto più sintetico: frasi brevi, al massimo la metà dei testi, e chiudi sempre il JSON." };
        if (passo === "ricerca" || passo === "approfondisci") corta.testo = chiamata.testo + "\n\nRISULTATI GIÀ TROVATI (usa solo questi indirizzi):\n" + (r.trovate || []).map((t) => `- ${t.titolo}: ${t.url}`).join("\n");
        const r2 = await chiedi(corta);
        usd += r2.usd; await registraSpesa(passo, r2.usd, r2.ricerche);
        try { o = leggiJSON(r2.text); } catch {}
        if (!o) {
          const motivo = r2.stop === "max_tokens" ? "risposta troppo lunga anche accorciata" : "risposta non leggibile";
          await store("config").setJSON("ultimoErrore", { quando: new Date().toISOString(), passo, status: 200, motivo, dettaglio: (r2.stop + " · " + r2.text.slice(0, 260)) }).catch(() => {});
          throw new Error("parse");
        }
        r = { ...r2, trovate: (r.trovate || []).concat(r2.trovate || []) };
      }
      out = { o, trovate: r.trovate };
      if (chiaveCache) await cache.setJSON(chiaveCache, out);
    }
    const o = out.o || {};

    // --- pulizia e salvataggio (ogni passaggio scrive solo il suo pezzo)
    let dato;
    if (passo === "argomenti") {
      const m = await leggiMeta(uid, cid);
      m.titolo = s(o.titolo, 120) || m.titolo;
      m.argomenti = coperturaCompleta((Array.isArray(o.argomenti) ? o.argomenti : []).slice(0, MAX_ARGOMENTI).map((a) => ({ titolo: s(a && a.titolo, 120), descrizione: s(a && a.descrizione, 300), da: Number(a && a.da) || 0, a: Number(a && a.a) || 0 })).filter((a) => a.titolo), nPag);
      await salvaMeta(uid, cid, m);
      dato = { titolo: m.titolo, argomenti: m.argomenti };
    } else if (passo === "ricerca") {
      const vere = new Map((out.trovate || []).map((t) => [normUrl(t.url), t])), scelte = [];
      for (const f of (Array.isArray(o.fonti) ? o.fonti : []).slice(0, MAX_FONTI_PER_ARGOMENTO)) {
        const v = vere.get(normUrl(f && f.url));
        if (!v || scelte.some((x) => normUrl(x.url) === normUrl(v.url))) continue; // fonte non restituita dalla ricerca: scartata
        scelte.push({ url: v.url, titolo: s(f.titolo, 200) || v.titolo, sito: s(f.sito, 80), tipo: s(f.tipo, 30), punti: lista(f.punti, 5, 300) });
      }
      dato = { fonti: scelte, data: new Date().toISOString() };
      await salvaPezzo(uid, cid, "ricerca/" + i, dato);
    } else if (passo === "capitolo") {
      const valide = new Set(fonti.map((f) => f.n));
      const pulisci = (t, n) => s(t, n).replace(/\[(\d+)\]/g, (m, x) => (valide.has(Number(x)) ? m : ""));
      dato = {
        titolo: s(o.titolo, 140) || arg.titolo,
        paragrafi: (Array.isArray(o.paragrafi) ? o.paragrafi : []).slice(0, 6).map((p) => pulisci(p, 1400)).filter(Boolean),
        esempio: pulisci(o.esempio, 700), trappola: pulisci(o.trappola, 700), ricorda: pulisci(o.ricorda, 500),
        confronto: (Array.isArray(o.confronto) ? o.confronto : []).slice(0, 6).map((c) => ({ tipo: ["ok", "incompleto", "diverso"].includes(c && c.tipo) ? c.tipo : "ok", testo: pulisci(c && c.testo, 500) })).filter((c) => c.testo),
        collegati: lista(o.collegati, 5, 140),
      };
      await salvaPezzo(uid, cid, "capitolo/" + i, dato);
    } else if (passo === "mappa" || passo === "mappaT") {
      const rami = (Array.isArray(o.rami) ? o.rami : []).slice(0, 6).map((r) => ({ titolo: s(r && r.titolo, 50), testo: s(r && r.testo, 260).replace(/\[\d+\]/g, ""), foglie: lista(r && r.foglie, 4, 90), capitolo: Math.max(1, Number(r && r.capitolo) || 1) })).filter((r) => r.titolo);
      dato = { centro: s(o.centro, 60), sottotitolo: s(o.sottotitolo, 140), rami,
        collegamenti: (Array.isArray(o.collegamenti) ? o.collegamenti : []).slice(0, 3).map((c) => ({ da: Number(c && c.da) || 0, a: Number(c && c.a) || 0, perche: s(c && c.perche, 120) })).filter((c) => c.da >= 1 && c.a >= 1 && c.da <= rami.length && c.a <= rami.length && c.da !== c.a && c.perche) };
      await salvaPezzo(uid, cid, "mappa", dato);
    } else if (passo === "domande" || passo === "domandeT") {
      dato = { crocette: crocetteOk(o.crocette, 10), orali: (Array.isArray(o.orali) ? o.orali : []).slice(0, 3).map((x) => ({ domanda: s(x && x.domanda, 300), punti: lista(x && x.punti, 6, 200) })).filter((x) => x.domanda) };
      await salvaPezzo(uid, cid, "domande/" + i, dato);
    } else if (passo === "approfondisci") {
      // le fonti nuove restano come [N1], [N2]: i numeri veri si assegnano quando la dispensa si ricompone
      const vere = new Map((out.trovate || []).map((t) => [normUrl(t.url), t]));
      const nuove = (Array.isArray(o.nuove) ? o.nuove.slice(0, 2) : []).map((f) => { const v = vere.get(normUrl(f && f.url)); return v ? { url: v.url, titolo: s(f.titolo, 200) || v.titolo } : null; });
      const tieni = (t, n) => s(t, n).replace(/\[N(\d+)\]/g, (m, x) => (nuove[x - 1] ? `[N${nuove.slice(0, x).filter(Boolean).length}]` : ""));
      await salvaPezzo(uid, cid, "app/" + b.chiave, {
        titolo: s(o.titolo, 140), paragrafi: (Array.isArray(o.paragrafi) ? o.paragrafi : []).slice(0, 5).map((p) => tieni(p, 1400)).filter(Boolean),
        esempi: (Array.isArray(o.esempi) ? o.esempi : []).slice(0, 2).map((p) => tieni(p, 700)).filter(Boolean),
        collegamenti: lista(o.collegamenti, 5, 140), crocette: crocetteOk(o.crocette, 3).map((q) => ({ ...q, fonte: tieni(q.fonte, 30) })),
        nuove: nuove.filter(Boolean), capitolo: Math.max(0, Number(b.capitolo) || 0), data: new Date().toISOString(),
      });
      const dd = await assembla(uid, cid);
      return json({ ok: true, usd, dato: dd.approfondimenti[b.chiave], fonti: dd.fonti });
    } else if (passo === "orale") {
      const fine = o.fine === true;
      return json({ ok: true, usd, dato: {
        battuta: s(o.battuta, 600), fine,
        voto: fine ? Math.max(0, Math.min(30, Math.round(Number(o.voto) || 0))) : null, lode: fine && o.lode === true && Number(o.voto) >= 30,
        punti: fine && Array.isArray(o.punti) ? o.punti.slice(0, 6).map((x) => x === true) : [],
        bene: fine ? lista(o.bene, 3, 300) : [], manca: fine ? lista(o.manca, 3, 300) : [], consiglio: fine ? s(o.consiglio, 300) : "",
      } });
    }
    return json({ ok: true, usd, gia: usd === 0, dato });
  } catch (e) {
    if (e && e.message === "parse") return json({ error: "parse" }, 502);
    if (e && e.message === "upstream") {
      // Il motivo resta nei log di Netlify e nel pannello (mai la chiave: Anthropic non la rimanda indietro).
      const d = String(e.dettaglio || ""), motivo = e.status === 401 ? "chiave non valida" : /credit balance/i.test(d) ? "credito Anthropic esaurito"
        : e.status === 404 || /model/i.test(d) && e.status === 400 ? "modello o strumento non disponibile" : e.status === 429 ? "troppe richieste ad Anthropic" : e.status >= 500 ? "Anthropic momentaneamente non disponibile" : "richiesta rifiutata da Anthropic";
      console.error("anthropic", passo, e.status, d);
      await store("config").setJSON("ultimoErrore", { quando: new Date().toISOString(), passo, status: e.status, motivo, dettaglio: d.slice(0, 300) }).catch(() => {});
      return json({ error: "upstream", status: e.status }, 502);
    }
    console.error("genera", passo, e && e.stack);
    return json({ error: "errore" }, 500);
  }
}
