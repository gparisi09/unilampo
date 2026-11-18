import { store, json, chiavePropria, aiAccesa, controllaPin, oggi } from "../lib/base.mjs";
import * as R from "../lib/regole.mjs";

// Pannello del titolare (/pannello): stato AI, interruttore, spesa e tester. Tutto dietro il PIN.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  const e = controllaPin(req, b.pin);
  if (e) return json({ error: e }, e === "troppi" ? 429 : 403);

  if (b.azione === "interruttore") {
    if (b.accesa === true && !chiavePropria()) return json({ error: "nochiave" }, 409);
    await store("config").setJSON("ai", { accesa: b.accesa === true, quando: new Date().toISOString() });
  }

  // spesa: oggi e ultimi 7 giorni
  const sp = store("spesa"), giorni = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
    const g = (await sp.get(d, { type: "json" }).catch(() => null)) || { usd: 0, voci: {} };
    giorni.push({ giorno: d, usd: g.usd, voci: g.voci });
  }
  const og = giorni.find((g) => g.giorno === oggi()) || giorni[giorni.length - 1];

  // tester: solo numeri, mai il contenuto
  const ut = store("utenti"), tester = [];
  try {
    const l = await ut.list();
    for (const x of (l.blobs || []).slice(0, 100)) {
      const d = await ut.get(x.key, { type: "json" }).catch(() => null);
      if (!d) continue;
      const risposte = Object.values(d.risposte || {}).reduce((a, r) => a + (r.ok || 0) + (r.ko || 0), 0);
      tester.push({ codice: x.key, materie: (d.materie || []).length, dispense: (d.caricamenti || []).filter((c) => c.stato === "pronta").length, caricamenti: (d.caricamenti || []).length, risposte, orali: (d.orali || []).length, agg: d.agg || null });
    }
  } catch {}
  tester.sort((a, b) => (b.agg || 0) - (a.agg || 0));

  const ultimoErrore = await store("config").get("ultimoErrore", { type: "json" }).catch(() => null);
  return json({
    ultimoErrore,
    accesa: await aiAccesa(), chiave: chiavePropria(), tetto: R.TETTO_GIORNO, oggi: og, giorni, tester,
    regole: { ECONOMICO: R.ECONOMICO, COSTOSO: R.COSTOSO, PREZZI: R.PREZZI, PREZZO_RICERCA: R.PREZZO_RICERCA, MAX_FONTI_PER_ARGOMENTO: R.MAX_FONTI_PER_ARGOMENTO, RICERCHE_PER_ARGOMENTO: R.RICERCHE_PER_ARGOMENTO, MAX_ARGOMENTI: R.MAX_ARGOMENTI },
  });
};
export const config = { path: "/api/pannello" };
