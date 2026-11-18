import { store, uidOk, idOk } from "../lib/base.mjs";
import { esegui } from "../lib/passi.mjs";
import { assembla, base, leggiMeta, salvaMeta } from "../lib/dispensa.mjs";
import { avvisa } from "../lib/avvisi.mjs";

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

  // parti da preparare: quelle già scelte più quelle aggiunte adesso ("+ Aggiungi la mappa", ecc.)
  const meta = await leggiMeta(uid, cid).catch(() => null);
  if (!meta) return;
  const vecchie = meta.parti || { dispensa: true }, nuove = b.parti || {};
  const P = { dispensa: !!(vecchie.dispensa || nuove.dispensa), test: !!(vecchie.test || nuove.test), mappa: !!(vecchie.mappa || nuove.mappa) };
  if (JSON.stringify(P) !== JSON.stringify(meta.parti)) { meta.parti = P; await salvaMeta(uid, cid, meta); }

  const L = { parti: P, fase: "Leggo gli argomenti…", fatti: 0, totali: 10, errore: "", dove: "", fine: false, inizio: Date.now(), conta: { argomenti: 0, fonti: 0, capitoli: 0, domande: 0, mappa: 0, n: 0 } };
  const salva = () => st.setJSON(k, { ...L, agg: Date.now() }).catch(() => {});
  const passo = async (nome, extra) => {
    const r = await esegui({ uid, cid, passo: nome, materia: b.materia, ...extra });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "errore"); e.codice = j.error || "errore"; throw e; }
    L.fatti++; L.conta[{ argomenti: "argomenti", ricerca: "fonti", capitolo: "capitoli", domande: "domande", domandeT: "domande", mappa: "mappa", mappaT: "mappa" }[nome]]++; await salva();
    return j;
  };
  await salva();
  try {
    let d = await assembla(uid, cid);
    if (!d) throw Object.assign(new Error("nessuno"), { codice: "nessuno" });
    if (!d.argomenti.length) { await passo("argomenti"); d = await assembla(uid, cid); }
    const n = d.argomenti.length, idx = d.argomenti.map((a, i) => i);
    const conDomande = P.dispensa || P.test, conMappa = P.dispensa || P.mappa;
    L.totali = 1 + (P.dispensa ? n * 2 : 0) + (conDomande ? n : 0) + (conMappa ? 1 : 0);
    L.conta = { argomenti: 1, fonti: Object.keys(d.ricerca).length, capitoli: Object.keys(d.capitoli).length, domande: Object.keys(d.domande).length, mappa: d.mappa ? 1 : 0, n };
    L.fatti = 1 + (P.dispensa ? L.conta.fonti + L.conta.capitoli : 0) + (conDomande ? L.conta.domande : 0) + (conMappa ? L.conta.mappa : 0);
    if (P.dispensa) {
      L.fase = `Cerco fonti affidabili per ${n} ${n === 1 ? "argomento" : "argomenti"}…`; await salva();
      await aParti(idx.filter((i) => !d.ricerca[i]), 4, (i) => passo("ricerca", { indice: i }));
      d = await assembla(uid, cid);
      for (let t = 0; t < 5 && d.argomenti.some((a, i) => !d.ricerca[i]); t++) { await new Promise((r) => setTimeout(r, 1500)); d = await assembla(uid, cid); }
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
    } else {
      // solo test e/o mappa: direttamente dal testo caricato, modello economico, niente ricerca né capitoli
      if (P.test) { L.fase = "Preparo le domande…"; await salva(); await aParti(idx.filter((i) => !d.domande[i]), 4, (i) => passo("domandeT", { indice: i })); }
      if (P.mappa && !d.mappa) { L.fase = "Disegno la mappa…"; await salva(); await passo("mappaT"); }
    }
    L.fase = "Dispensa pronta"; L.fine = true; L.fatti = L.totali; await salva();
    const m = await leggiMeta(uid, cid).catch(() => null);
    await avvisa(uid, P.dispensa ? "Dispensa pronta ✓" : "Pronto ✓", (m && m.titolo) || "La tua dispensa è pronta: aprila e inizia a studiare.", "/?d=" + cid).catch(() => {});
  } catch (e) {
    L.errore = (e && e.codice) || "errore"; L.dove = L.fase; await salva();
    console.error("prepara", cid, L.errore);
    if (L.errore !== "tetto" && L.errore !== "spenta") await avvisa(uid, "Preparazione ferma", "Apri UniLampo e premi «Riprendi da dove si è fermata».", "/?d=" + cid).catch(() => {});
  }
};
export const config = { path: "/api/prepara", background: true };
