import { costoDaUso, DOMINI_ESCLUSI } from "./regole.mjs";

// Sempre l'indirizzo di Anthropic con la chiave dell'utente: mai l'AI Gateway di Netlify.
const URL_API = "https://api.anthropic.com/v1/messages";

// Chiama Claude. `fisso` è la parte lunga e ripetuta (gli appunti): con cache=true si legge dalla cache
// nelle chiamate successive e costa molto meno. `ricerche` > 0 attiva la ricerca web con quel tetto.
export async function chiedi({ modello, istruzioni, fisso = "", cache = false, testo, max, ricerche = 0 }) {
  const system = [{ type: "text", text: istruzioni }];
  if (fisso) system.push(cache ? { type: "text", text: fisso, cache_control: { type: "ephemeral" } } : { type: "text", text: fisso });
  const body = { model: modello, max_tokens: max, system, messages: [{ role: "user", content: testo }] };
  if (ricerche > 0) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: ricerche, blocked_domains: DOMINI_ESCLUSI }];
  const r = await fetch(URL_API, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = new Error("upstream"); e.status = r.status;
    try { e.dettaglio = (await r.text()).slice(0, 300); } catch {}
    throw e;
  }
  const d = await r.json();
  const u = d.usage || {};
  const nRicerche = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  // Le sole fonti valide sono gli indirizzi che la ricerca ha restituito davvero.
  const trovate = [];
  for (const c of d.content || []) {
    if (c.type === "web_search_tool_result" && Array.isArray(c.content))
      for (const x of c.content) if (x && x.url) trovate.push({ url: x.url, titolo: String(x.title || "").slice(0, 200) });
  }
  const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  return { text, trovate, usd: costoDaUso(modello, u, nRicerche), ricerche: nRicerche, stop: d.stop_reason || "" };
}

// Estrae l'oggetto JSON dalla risposta. Se la risposta è stata tagliata a metà,
// tiene tutto ciò che è completo e chiude le parentesi: meglio 5 domande su 6 che nessuna.
export function leggiJSON(t) {
  let x = String(t || "").replace(/```(?:json)?/gi, "");
  const a = x.indexOf("{");
  if (a < 0) throw new Error("parse");
  x = x.slice(a);
  const b = x.lastIndexOf("}");
  for (const y of [b > 0 ? x.slice(0, b + 1) : null, b > 0 ? x.slice(0, b + 1).replace(/,\s*([\]}])/g, "$1") : null]) {
    if (!y) continue;
    try { return JSON.parse(y); } catch {}
  }
  return ripara(x);
}
function ripara(x) {
  const pila = [], punti = [];
  let inStr = false, esc = false;
  for (let i = 0; i < x.length; i++) {
    const c = x[i];
    if (inStr) {
      if (esc) esc = false; else if (c === "\\") esc = true;
      else if (c === '"') { inStr = false; if (pila[pila.length - 1] === "[") punti.push([i + 1, pila.slice()]); }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") pila.push(c);
    else if (c === "}" || c === "]") { pila.pop(); punti.push([i + 1, pila.slice()]); }
  }
  for (let k = punti.length - 1; k >= 0; k--) {
    const [fine, p] = punti[k];
    const chiudi = p.slice().reverse().map((c) => (c === "{" ? "}" : "]")).join("");
    try { const o = JSON.parse(x.slice(0, fine).replace(/,\s*$/, "") + chiudi); if (o && typeof o === "object") return o; } catch {}
  }
  throw new Error("parse");
}
