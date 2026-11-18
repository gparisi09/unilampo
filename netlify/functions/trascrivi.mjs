import { json, uidOk, aiAccesa, puoSpendere, registraSpesa } from "../lib/base.mjs";
import { URL_OPENAI, chiaveOpenAI } from "../lib/openai.mjs";
import { TRASCRIZIONE_MODELLO, USD_TRASCRIZIONE_AL_SECONDO } from "../lib/regole.mjs";

// Trascrive la risposta a voce registrata dal telefono (funziona anche su iPhone).
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!chiaveOpenAI()) return json({ error: "off" }, 503);
  const url = new URL(req.url), uid = url.searchParams.get("uid") || "", sec = Math.max(1, Math.min(600, Number(url.searchParams.get("sec")) || 60));
  if (!uidOk(uid)) return json({ error: "bad" }, 400);
  if (!(await aiAccesa())) return json({ error: "spenta" }, 503);
  const usd = sec * USD_TRASCRIZIONE_AL_SECONDO;
  if (!(await puoSpendere(usd)).ok) return json({ error: "tetto" }, 429);
  const tipo = (req.headers.get("content-type") || "audio/webm").split(";")[0];
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return json({ text: "" });
  if (buf.byteLength > 20e6) return json({ error: "troppo" }, 413);
  const ext = /mp4|m4a|aac/.test(tipo) ? "m4a" : /ogg/.test(tipo) ? "ogg" : /wav/.test(tipo) ? "wav" : "webm";
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: tipo }), "risposta." + ext);
  fd.append("model", TRASCRIZIONE_MODELLO);
  fd.append("language", "it");
  fd.append("prompt", "Risposta orale di una studentessa universitaria a un esame: termini tecnici della materia.");
  const r = await fetch(URL_OPENAI + "/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY }, body: fd });
  if (!r.ok) { console.error("trascrivi", r.status, (await r.text().catch(() => "")).slice(0, 200)); return json({ error: "upstream", status: r.status }, 502); }
  await registraSpesa("trascrizione", usd);
  const d = await r.json().catch(() => ({}));
  return json({ text: String(d.text || "").trim().slice(0, 5000) });
};
export const config = { path: "/api/trascrivi" };
