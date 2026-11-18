import { store, json, uidOk } from "../lib/base.mjs";

// Progressi della studentessa (materie, caricamenti, risposte, orali): un documento per codice.
// Con lo stesso codice si ritrovano su un altro telefono.
export default async (req) => {
  if (req.method === "GET") {
    const uid = new URL(req.url).searchParams.get("uid");
    if (!uidOk(uid)) return json({ error: "bad" }, 400);
    const d = await store("utenti").get(uid, { type: "json" }).catch(() => null);
    return json({ data: d });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  if (!uidOk(b.uid)) return json({ error: "bad" }, 400);
  const raw = JSON.stringify(b.data || {});
  if (raw.length > 400000) return json({ error: "troppo" }, 413);
  await store("utenti").set(b.uid, raw);
  return json({ ok: true });
};
export const config = { path: "/api/dati" };
