// Pagine degli appunti. Il testo si salva con un segno all'inizio di ogni pagina: [[PAGINA 3]].
// Dai PDF le pagine sono quelle vere; per il testo incollato si fanno "parti" di circa 2.500 caratteri.
export const SEGNO = /\[\[PAGINA (\d+)\]\]/g;
export const CARATTERI_PER_PARTE = 2500;

export function haPagine(t) { return /\[\[PAGINA 1\]\]/.test(t); }

export function segna(t) {
  if (haPagine(t)) return t;
  const out = []; let pezzo = "", n = 0;
  for (const par of t.split(/\n\n+/)) {
    if (pezzo && pezzo.length + par.length > CARATTERI_PER_PARTE) { out.push(`[[PAGINA ${++n}]]\n${pezzo}`); pezzo = ""; }
    // un paragrafo lunghissimo si spezza
    let p = par;
    while (p.length > CARATTERI_PER_PARTE * 1.6) { if (pezzo) { out.push(`[[PAGINA ${++n}]]\n${pezzo}`); pezzo = ""; } out.push(`[[PAGINA ${++n}]]\n${p.slice(0, CARATTERI_PER_PARTE)}`); p = p.slice(CARATTERI_PER_PARTE); }
    pezzo = pezzo ? pezzo + "\n\n" + p : p;
  }
  if (pezzo) out.push(`[[PAGINA ${++n}]]\n${pezzo}`);
  return out.join("\n\n");
}

export function pagine(t) { // [{n, testo}]
  const out = []; let m, ultimo = null; const re = new RegExp(SEGNO.source, "g");
  while ((m = re.exec(t))) { if (ultimo) ultimo.testo = t.slice(ultimo.da, m.index).trim(); ultimo = { n: Number(m[1]), da: m.index + m[0].length }; out.push(ultimo); }
  if (ultimo) ultimo.testo = t.slice(ultimo.da).trim();
  return out.map((p) => ({ n: p.n, testo: p.testo }));
}

export function numeroPagine(t) { const p = pagine(t); return p.length ? p[p.length - 1].n : 0; }

// Testo delle pagine da..a, con i segni di pagina (servono per citare).
export function fetta(t, da, a, max = 45000) {
  const sel = pagine(t).filter((p) => p.n >= da && p.n <= a).map((p) => `[[PAGINA ${p.n}]]\n${p.testo}`).join("\n\n");
  return sel.length > max ? sel.slice(0, max) : sel;
}

// Taglia a fine pagina, non a metà.
export function tagliaAPagina(t, max) {
  if (t.length <= max) return t;
  const cut = t.slice(0, max), k = cut.lastIndexOf("[[PAGINA ");
  return (k > max * 0.5 ? cut.slice(0, k) : cut).trim();
}
