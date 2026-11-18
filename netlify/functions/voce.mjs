import { store, json, uidOk, aiAccesa, puoSpendere, registraSpesa, sha } from "../lib/base.mjs";
import { URL_OPENAI, chiaveOpenAI } from "../lib/openai.mjs";
import { VOCE_MODELLO, VOCE, USD_VOCE_PER_CARATTERE } from "../lib/regole.mjs";

// Voce della commissione: testo → audio con un modello vocale vero. Ogni frase resta in archivio:
// la stessa domanda non si paga due volte. Se non risponde, l'app usa la voce del telefono.
const ISTRUZIONI = "Parla in italiano, con accento italiano neutro e naturale. Sei il presidente di una commissione d'esame universitario: tono cortese, calmo e professionale, ritmo tranquillo, pause naturali. Non leggere in modo meccanico.";
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!chiaveOpenAI()) return json({ error: "off" }, 503);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  const testo = String(b.testo || "").replace(/\s+/g, " ").trim().slice(0, 900);
  if (!testo || !uidOk(b.uid)) return json({ error: "bad" }, 400);
  const arch = store("voce"), k = await sha(VOCE_MODELLO + VOCE + testo);
  const audio = (buf) => new Response(buf, { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000" } });
  const c = await arch.get(k, { type: "arrayBuffer" }).catch(() => null);
  if (c) return audio(c);
  if (!(await aiAccesa())) return json({ error: "spenta" }, 503);
  const usd = testo.length * USD_VOCE_PER_CARATTERE;
  if (!(await puoSpendere(usd)).ok) return json({ error: "tetto" }, 429);
  const r = await fetch(URL_OPENAI + "/audio/speech", {
    method: "POST", headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: VOCE_MODELLO, voice: VOCE, input: testo, instructions: ISTRUZIONI, response_format: "mp3" }),
  });
  if (!r.ok) { console.error("voce", r.status, (await r.text().catch(() => "")).slice(0, 200)); return json({ error: "upstream", status: r.status }, 502); }
  await registraSpesa("voce", usd);
  const buf = await r.arrayBuffer();
  await arch.set(k, buf).catch(() => {});
  return audio(buf);
};
export const config = { path: "/api/voce" };
