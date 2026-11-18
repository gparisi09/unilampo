import { store, json, uidOk, idOk } from "../lib/base.mjs";
import { MAX_CARATTERI_APPUNTI } from "../lib/regole.mjs";

// POST: salva gli appunti di un caricamento (testo già estratto dal PDF sul telefono) e crea la dispensa vuota.
// GET: restituisce la dispensa salvata. DELETE: elimina caricamento e dispensa.
const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" || req.method === "DELETE") {
    const uid = url.searchParams.get("uid"), cid = url.searchParams.get("cid");
    if (!uidOk(uid) || !idOk(cid)) return json({ error: "bad" }, 400);
    if (req.method === "DELETE") {
      await store("dispense").delete(`${uid}/${cid}`).catch(() => {});
      await store("testi").delete(`${uid}/${cid}`).catch(() => {});
      return json({ ok: true });
    }
    const d = await store("dispense").get(`${uid}/${cid}`, { type: "json" }).catch(() => null);
    return d ? json({ dispensa: d }) : json({ error: "nessuna" }, 404);
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  if (!uidOk(b.uid) || !idOk(b.cid)) return json({ error: "bad" }, 400);
  let testo = String(b.testo || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (testo.length < 200) return json({ error: "corto" }, 400);
  const tagliato = testo.length > MAX_CARATTERI_APPUNTI;
  testo = testo.slice(0, MAX_CARATTERI_APPUNTI);
  const k = `${b.uid}/${b.cid}`;
  const vecchia = await store("dispense").get(k, { type: "json" }).catch(() => null);
  if (vecchia) return json({ error: "esiste" }, 409);
  await store("testi").set(k, testo);
  await store("dispense").setJSON(k, {
    materia: s(b.materia, 120), titolo: s(b.titolo, 120), file: s(b.file, 160), caratteri: testo.length, creato: new Date().toISOString(),
    argomenti: [], ricerca: {}, fonti: [], capitoli: {}, mappa: null, domande: {}, approfondimenti: {},
  });
  return json({ ok: true, caratteri: testo.length, tagliato });
};
export const config = { path: "/api/caricamento" };
