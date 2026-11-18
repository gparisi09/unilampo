import { store, uidOk, idOk } from "../lib/base.mjs";
import { esegui } from "../lib/passi.mjs";
import { assembla, base } from "../lib/dispensa.mjs";

// Prepara tutta la dispensa sul server, in background (fino a 15 minuti):
// continua anche se la studentessa chiude l'app. L'avanzamento si salva in "lavori" e l'app lo legge quando torna.
async function aParti(lista, quanti, fn) {
  const coda = lista.slice(), lavoratori = [];
  for (let k = 0; k < Math.min(quanti, coda.length); k++) lavoratori.push((async () => { while (coda.length) await fn(coda.shift()); })());
  await Promise.all(lavoratori);
}

export default async (req) => {
  let b;
  try { b = await req.json(); } catch { return; }
  const { uid, cid } = b || {};
  if (!uidOk(uid) || !idOk(cid)) return;
  const st = store("lavori"), k = base(uid, cid);
  const prima = await st.get(k, { type: "json" }).catch(() => null);
  if (prima && !prima.fine && !prima.errore && Date.now() - (prima.agg || 0) < 90000) return; // già in corso

  const L = { fase: "Leggo gli argomenti…", fatti: 0, totali: 10, errore: "", fine: false, inizio: Date.now() };
  const salva = () => st.setJSON(k, { ...L, agg: Date.now() }).catch(() => {});
  const passo = async (nome, extra) => {
    const r = await esegui({ uid, cid, passo: nome, materia: b.materia, ...extra });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "errore"); e.codice = j.error || "errore"; throw e; }
    L.fatti++; await salva();
    return j;
  };
  await salva();
  try {
    let d = await assembla(uid, cid);
    if (!d) throw Object.assign(new Error("nessuno"), { codice: "nessuno" });
    if (!d.argomenti.length) { await passo("argomenti"); d = await assembla(uid, cid); }
    const n = d.argomenti.length, idx = d.argomenti.map((a, i) => i);
    L.totali = 1 + n * 3 + 1;
    L.fatti = 1 + Object.keys(d.ricerca).length + Object.keys(d.capitoli).length + Object.keys(d.domande).length + (d.mappa ? 1 : 0);
    L.fase = `Cerco fonti affidabili per ${n} ${n === 1 ? "argomento" : "argomenti"}…`; await salva();
    await aParti(idx.filter((i) => !d.ricerca[i]), 4, (i) => passo("ricerca", { indice: i }));
    d = await assembla(uid, cid);
    L.fase = "Scrivo i capitoli…"; await salva();
    let pronti = Object.keys(d.capitoli).length;
    const capEDom = async (i) => {
      if (!d.capitoli[i]) { await passo("capitolo", { indice: i }); pronti++; L.fase = `Scrivo i capitoli · ${pronti} di ${n} pronti`; await salva(); }
      if (!d.domande[i]) await passo("domande", { indice: i });
    };
    // il primo capitolo da solo (prepara la memoria condivisa degli appunti), poi gli altri insieme
    await capEDom(0);
    await aParti(idx.slice(1), 3, capEDom);
    d = await assembla(uid, cid);
    if (!d.mappa) { L.fase = "Disegno la mappa…"; await salva(); await passo("mappa"); }
    L.fase = "Dispensa pronta"; L.fine = true; L.fatti = L.totali; await salva();
  } catch (e) {
    L.errore = (e && e.codice) || "errore"; await salva();
    console.error("prepara", cid, L.errore);
  }
};
export const config = { path: "/api/prepara", background: true };
