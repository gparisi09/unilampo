import { getStore } from "@netlify/blobs";
import { TETTO_GIORNO } from "./regole.mjs";

// Archivio (Netlify Blobs). Nelle prove in locale si usa una memoria finta.
export const store = (nome) => (globalThis.__memStore ? globalThis.__memStore(nome) : getStore(nome));

export const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const uidOk = (u) => /^u[a-z0-9]{8,30}$/.test(String(u || ""));
export const idOk = (u) => /^[a-z0-9-]{4,60}$/.test(String(u || ""));
export const oggi = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

export async function sha(testo) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(testo)));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// Interruttore AI: spento di default. Si accende solo con il PIN (variabile UNILAMPO_PIN su Netlify).
// Conta solo la chiave dell'utente: se manca, Netlify metterebbe la sua (AI Gateway, pagata in crediti Netlify) e qui la ignoriamo.
export const chiavePropria = () => !!process.env.ANTHROPIC_API_KEY && !/netlify/i.test(process.env.ANTHROPIC_BASE_URL || "");
export async function aiAccesa() {
  if (!chiavePropria()) return false;
  const c = await store("config").get("ai", { type: "json" }).catch(() => null);
  return !!(c && c.accesa === true);
}

// Spesa del giorno, in dollari, calcolata dai token davvero usati.
export async function spesaOggi() {
  const g = await store("spesa").get(oggi(), { type: "json" }).catch(() => null);
  return g || { usd: 0, voci: {} };
}
export async function registraSpesa(voce, usd, ricerche = 0) {
  const st = store("spesa"), k = oggi();
  const g = (await st.get(k, { type: "json" }).catch(() => null)) || { usd: 0, voci: {} };
  g.usd = Math.round((g.usd + usd) * 1e5) / 1e5;
  const v = g.voci[voce] || { chiamate: 0, usd: 0 };
  v.chiamate++; v.usd = Math.round((v.usd + usd) * 1e5) / 1e5; v.ricerche = (v.ricerche || 0) + ricerche;
  g.voci[voce] = v;
  await st.setJSON(k, g);
  return g;
}
export async function puoSpendere(stima) {
  const g = await spesaOggi();
  return { ok: g.usd + stima <= TETTO_GIORNO, speso: g.usd, tetto: TETTO_GIORNO };
}

// PIN del pannello: confronto e blocco dopo troppi tentativi sbagliati.
const tentativi = new Map();
export function controllaPin(req, pin) {
  const giusto = process.env.UNILAMPO_PIN;
  if (!giusto) return "nopin";
  const ip = req.headers.get("x-nf-client-connection-ip") || "x", t = tentativi.get(ip) || 0;
  if (t >= 8) return "troppi";
  if (String(pin || "") !== giusto) { tentativi.set(ip, t + 1); return "pin"; }
  tentativi.delete(ip);
  return "";
}
