import { store, json, uidOk } from "../lib/base.mjs";

// Salva l'iscrizione alle notifiche di un telefono (massimo 5 dispositivi per codice).
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  const s = b.sub;
  if (!uidOk(b.uid) || !s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: "bad" }, 400);
  const st = store("notifiche"), subs = ((await st.get(b.uid, { type: "json" }).catch(() => null)) || []).filter((x) => x.endpoint !== s.endpoint);
  subs.push({ endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } });
  await st.setJSON(b.uid, subs.slice(-5));
  return json({ ok: true });
};
export const config = { path: "/api/notifiche" };
