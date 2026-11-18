import { store, json, uidOk, idOk } from "../lib/base.mjs";
import { assembla } from "../lib/dispensa.mjs";
import { pagine } from "../lib/pagine.mjs";
import { avvisa } from "../lib/avvisi.mjs";

// Gruppi di studio e condivisioni in sola lettura.
// Chi riceve una dispensa non vede mai il codice dell'autore: vede solo il nome che l'autore ha scelto.
// g/<gid>: { nome, codice, creato, membri: [{ u, nome, dal }], voci: [{ sid, nome, uid, titolo, materia, data, capitoli, domande }] }
// i/<codice>: gid            s/<sid>: { uid, cid, autore, titolo, materia, data, gid, attiva }
const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const rnd = (n) => { const a = "abcdefghjkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => a[x % a.length]).join(""); };
const st = () => store("gruppi");
const pubblicoGruppo = (g, uid) => ({
  gid: g.gid, nome: g.nome, codice: g.codice, creato: g.creato, sonoIo: uid,
  membri: g.membri.map((m) => ({ nome: m.nome, dal: m.dal, io: m.u === uid })),
  voci: g.voci.filter((v) => v.attiva !== false).map((v) => ({ sid: v.sid, nome: v.nome, titolo: v.titolo, materia: v.materia, data: v.data, capitoli: v.capitoli, domande: v.domande, mia: v.uid === uid })).reverse(),
});
const contaDi = (d) => ({ capitoli: Object.keys(d.capitoli || {}).length, domande: Object.values(d.domande || {}).reduce((t, x) => t + ((x && x.crocette) || []).length, 0) });

export default async (req) => {
  const url = new URL(req.url), G = st();
  if (req.method === "GET") {
    const sid = url.searchParams.get("s");
    if (sid) { // dispensa condivisa, in sola lettura
      if (!/^[a-z2-9]{10,20}$/.test(sid)) return json({ error: "bad" }, 400);
      const c = await G.get("s/" + sid, { type: "json" }).catch(() => null);
      if (!c || c.attiva === false) return json({ error: "tolta" }, 404);
      const n = Number(url.searchParams.get("pagina") || 0);
      if (n) { const t = await store("testi").get(`${c.uid}/${c.cid}`); const pg = t ? pagine(t).find((x) => x.n === n) : null; return pg ? json({ n, testo: pg.testo.slice(0, 12000) }) : json({ error: "nessuna" }, 404); }
      const d = await assembla(c.uid, c.cid);
      if (!d) return json({ error: "tolta" }, 404);
      delete d.lavoro;
      return json({ dispensa: d, autore: c.autore, data: c.data, sid });
    }
    const uid = url.searchParams.get("uid"), gid = url.searchParams.get("gid");
    if (!uidOk(uid) || !/^[a-z2-9]{8,16}$/.test(String(gid || ""))) return json({ error: "bad" }, 400);
    const g = await G.get("g/" + gid, { type: "json" }).catch(() => null);
    if (!g || !g.membri.some((m) => m.u === uid)) return json({ error: "fuori" }, 404);
    return json({ gruppo: pubblicoGruppo(g, uid) });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  if (!uidOk(b.uid)) return json({ error: "bad" }, 400);
  const mioNome = s(b.mioNome, 30) || "Anonimo";

  if (b.azione === "crea") {
    const nome = s(b.nome, 60); if (!nome) return json({ error: "nome" }, 400);
    const gid = rnd(10), codice = rnd(8).toUpperCase();
    const g = { gid, nome, codice, creato: new Date().toISOString(), membri: [{ u: b.uid, nome: mioNome, dal: new Date().toISOString() }], voci: [] };
    await G.setJSON("g/" + gid, g); await G.set("i/" + codice, gid);
    return json({ gruppo: pubblicoGruppo(g, b.uid) });
  }
  if (b.azione === "entra") {
    const codice = s(b.codice, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const gid = codice ? await G.get("i/" + codice).catch(() => null) : null;
    const g = gid ? await G.get("g/" + gid, { type: "json" }).catch(() => null) : null;
    if (!g) return json({ error: "codice" }, 404);
    if (g.membri.length >= 60 && !g.membri.some((m) => m.u === b.uid)) return json({ error: "pieno" }, 409);
    const io = g.membri.find((m) => m.u === b.uid);
    if (io) io.nome = mioNome; else g.membri.push({ u: b.uid, nome: mioNome, dal: new Date().toISOString() });
    await G.setJSON("g/" + g.gid, g);
    return json({ gruppo: pubblicoGruppo(g, b.uid) });
  }
  if (b.azione === "esci") {
    const g = await G.get("g/" + s(b.gid, 20), { type: "json" }).catch(() => null);
    if (!g) return json({ ok: true });
    g.membri = g.membri.filter((m) => m.u !== b.uid);
    await G.setJSON("g/" + g.gid, g);
    return json({ ok: true });
  }
  if (b.azione === "condividi") { // in un gruppo (gid) oppure con un link (senza gid)
    if (!idOk(b.cid)) return json({ error: "bad" }, 400);
    const d = await assembla(b.uid, b.cid);
    if (!d || !Object.keys(d.capitoli || {}).length && !Object.keys(d.domande || {}).length && !d.mappa) return json({ error: "vuota" }, 400);
    let g = null;
    if (b.gid) { g = await G.get("g/" + s(b.gid, 20), { type: "json" }).catch(() => null); if (!g || !g.membri.some((m) => m.u === b.uid)) return json({ error: "fuori" }, 404); }
    const sid = rnd(12), ora = new Date().toISOString(), titolo = s(b.titolo, 120) || d.titolo || "Dispensa", materia = s(b.materia, 80) || d.materia || "";
    await G.setJSON("s/" + sid, { uid: b.uid, cid: b.cid, autore: mioNome, titolo, materia, data: ora, gid: g ? g.gid : null, attiva: true });
    if (g) { g.voci.push({ sid, nome: mioNome, uid: b.uid, titolo, materia, data: ora, ...contaDi(d), attiva: true }); g.voci = g.voci.slice(-200); await G.setJSON("g/" + g.gid, g);
      await Promise.all(g.membri.filter((m) => m.u !== b.uid).map((m) => avvisa(m.u, "Nuova dispensa in " + g.nome, `${mioNome} ha pubblicato «${titolo}»`, "/?gr=" + g.gid).catch(() => {}))); }
    return json({ sid, gruppo: g ? pubblicoGruppo(g, b.uid) : null });
  }
  if (b.azione === "revoca") {
    const sid = s(b.sid, 20), c = await G.get("s/" + sid, { type: "json" }).catch(() => null);
    if (!c || c.uid !== b.uid) return json({ error: "no" }, 403);
    c.attiva = false; await G.setJSON("s/" + sid, c);
    if (c.gid) { const g = await G.get("g/" + c.gid, { type: "json" }).catch(() => null); if (g) { g.voci.forEach((v) => { if (v.sid === sid) v.attiva = false; }); await G.setJSON("g/" + g.gid, g); } }
    return json({ ok: true });
  }
  return json({ error: "azione" }, 400);
};
export const config = { path: "/api/gruppi" };
