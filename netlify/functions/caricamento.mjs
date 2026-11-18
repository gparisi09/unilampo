import { store, json, uidOk, idOk } from "../lib/base.mjs";
import { MAX_CARATTERI_APPUNTI } from "../lib/regole.mjs";
import { assembla, leggiMeta, salvaMeta, eliminaTutto } from "../lib/dispensa.mjs";
import { segna, numeroPagine, tagliaAPagina, pagine } from "../lib/pagine.mjs";

// POST: salva gli appunti di un caricamento (testo già estratto dal PDF sul telefono) e crea la dispensa vuota.
// GET: restituisce la dispensa ricomposta dai suoi pezzi. DELETE: elimina caricamento, dispensa e pezzi.
// Cosa preparare: dispensa completa, test, mappa (anche insieme). Di base la dispensa completa.
export const parti = (p) => { p = p || {}; const o = { dispensa: p.dispensa === true, test: p.test === true, mappa: p.mappa === true }; return o.dispensa || o.test || o.mappa ? o : { dispensa: true, test: false, mappa: false }; };
const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" || req.method === "DELETE") {
    const uid = url.searchParams.get("uid"), cid = url.searchParams.get("cid");
    if (!uidOk(uid) || !idOk(cid)) return json({ error: "bad" }, 400);
    if (req.method === "DELETE") { await eliminaTutto(uid, cid); return json({ ok: true }); }
    if (url.searchParams.get("pagina")) { // il testo originale di una pagina, per controllare da dove viene una frase
      const n = Number(url.searchParams.get("pagina")), t = await store("testi").get(`${uid}/${cid}`);
      const pg = t ? pagine(t).find((x) => x.n === n) : null;
      return pg ? json({ n, testo: pg.testo.slice(0, 12000) }) : json({ error: "nessuna" }, 404);
    }
    const d = await assembla(uid, cid);
    return d ? json({ dispensa: d }) : json({ error: "nessuna" }, 404);
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  if (!uidOk(b.uid) || !idOk(b.cid)) return json({ error: "bad" }, 400);
  const daPdf = /\[\[PAGINA 1\]\]/.test(String(b.testo || ""));
  let testo = String(b.testo || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (testo.replace(/\[\[PAGINA \d+\]\]/g, "").trim().length < 200) return json({ error: "corto" }, 400);
  testo = segna(testo);
  const totali = numeroPagine(testo);
  testo = tagliaAPagina(testo, MAX_CARATTERI_APPUNTI);
  const lette = numeroPagine(testo), tagliato = lette < totali;
  const k = `${b.uid}/${b.cid}`;
  if (await leggiMeta(b.uid, b.cid)) return json({ error: "esiste" }, 409);
  await store("testi").set(k, testo);
  await salvaMeta(b.uid, b.cid, { materia: s(b.materia, 120), titolo: s(b.titolo, 120), file: s(b.file, 160), caratteri: testo.length, creato: new Date().toISOString(), argomenti: [], parti: parti(b.parti),
    pagine: lette, pagineTotali: totali, tipoPagine: daPdf ? "pagina" : "parte", tagliato });
  return json({ ok: true, caratteri: testo.length, tagliato, pagine: lette, pagineTotali: totali });
};
export const config = { path: "/api/caricamento" };
