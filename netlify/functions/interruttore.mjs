import { store, json, chiavePropria } from "../lib/base.mjs";

// Accende o spegne l'AI. Serve il PIN scritto su Netlify (UNILAMPO_PIN): senza, l'AI resta spenta.
const tentativi = new Map();
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  const pin = process.env.UNILAMPO_PIN;
  if (!pin) return json({ error: "nopin" }, 403);
  const ip = req.headers.get("x-nf-client-connection-ip") || "x", t = tentativi.get(ip) || 0;
  if (t >= 8) return json({ error: "troppi" }, 429);
  if (String(b.pin || "") !== pin) { tentativi.set(ip, t + 1); return json({ error: "pin" }, 403); }
  tentativi.delete(ip);
  if (b.accesa === true && !chiavePropria()) return json({ error: "nochiave" }, 409);
  await store("config").setJSON("ai", { accesa: b.accesa === true, quando: new Date().toISOString() });
  return json({ ok: true, accesa: b.accesa === true });
};
export const config = { path: "/api/interruttore" };
