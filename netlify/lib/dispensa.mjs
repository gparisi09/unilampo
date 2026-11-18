import { store } from "./base.mjs";

// Ogni dispensa è fatta di pezzi salvati separatamente (fonti, capitoli, domande, mappa, approfondimenti):
// così più passaggi possono lavorare in parallelo senza sovrascriversi a vicenda.
// "dispense" tiene i dati generali e l'elenco degli argomenti; "pezzi" tiene tutto il resto.

const normUrl = (u) => String(u || "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
export const base = (uid, cid) => `${uid}/${cid}`;

export async function leggiMeta(uid, cid) {
  return (await store("dispense").get(base(uid, cid), { type: "json" }).catch(() => null)) || null;
}
export async function salvaMeta(uid, cid, m) { await store("dispense").setJSON(base(uid, cid), m); }
export async function salvaPezzo(uid, cid, nome, v) { await store("pezzi").setJSON(`${base(uid, cid)}/${nome}`, v); }
export async function eliminaTutto(uid, cid) {
  const p = store("pezzi");
  const l = await p.list({ prefix: base(uid, cid) + "/" }).catch(() => ({ blobs: [] }));
  for (const b of l.blobs || []) await p.delete(b.key).catch(() => {});
  await store("dispense").delete(base(uid, cid)).catch(() => {});
  await store("testi").delete(base(uid, cid)).catch(() => {});
  await store("lavori").delete(base(uid, cid)).catch(() => {});
}

// Ricompone la dispensa intera. Le fonti si numerano qui, sempre nello stesso ordine:
// prima quelle degli argomenti (in ordine), poi quelle nuove degli approfondimenti (in ordine di creazione).
export async function assembla(uid, cid) {
  const m = await leggiMeta(uid, cid);
  if (!m) return null;
  const p = store("pezzi"), pre = base(uid, cid) + "/";
  const l = await p.list({ prefix: pre }).catch(() => ({ blobs: [] }));
  const pezzi = {};
  await Promise.all((l.blobs || []).map(async (b) => { pezzi[b.key.slice(pre.length)] = await p.get(b.key, { type: "json" }).catch(() => null); }));
  const d = { ...m, argomenti: m.argomenti || [], ricerca: {}, fonti: [], capitoli: {}, mappa: pezzi.mappa || null, domande: {}, approfondimenti: {} };
  const aggiungi = (f) => {
    let g = d.fonti.find((x) => normUrl(x.url) === normUrl(f.url));
    if (!g) { g = { n: d.fonti.length + 1, url: f.url, titolo: f.titolo, sito: f.sito || "", tipo: f.tipo || "", punti: f.punti || [] }; d.fonti.push(g); }
    return g.n;
  };
  d.argomenti.forEach((a, i) => {
    const r = pezzi["ricerca/" + i];
    if (r) d.ricerca[i] = { nums: (r.fonti || []).map(aggiungi), data: r.data };
    if (pezzi["capitolo/" + i]) d.capitoli[i] = pezzi["capitolo/" + i];
    if (pezzi["domande/" + i]) d.domande[i] = pezzi["domande/" + i];
  });
  const app = Object.keys(pezzi).filter((k) => k.startsWith("app/")).map((k) => [k.slice(4), pezzi[k]]).filter((x) => x[1]).sort((a, b) => String(a[1].data).localeCompare(String(b[1].data)));
  const valide = () => new Set(d.fonti.map((f) => f.n));
  for (const [chiave, a] of app) {
    const nuove = (a.nuove || []).map(aggiungi), ok = valide();
    const fix = (t) => String(t || "").replace(/\[N(\d+)\]/g, (x, k) => (nuove[k - 1] ? `[${nuove[k - 1]}]` : "")).replace(/\[(\d+)\]/g, (x, k) => (ok.has(Number(k)) ? x : ""));
    d.approfondimenti[chiave] = { ...a, paragrafi: (a.paragrafi || []).map(fix), esempi: (a.esempi || []).map(fix), crocette: (a.crocette || []).map((q) => ({ ...q, fonte: fix(q.fonte) })) };
  }
  d.lavoro = await store("lavori").get(base(uid, cid), { type: "json" }).catch(() => null);
  return d;
}
