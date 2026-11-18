/* UniLampo · beta — dai tuoi appunti a dispense, test e orale. */
'use strict';
var $ = function (id) { return document.getElementById(id); };
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// Segni della dispensa: [[g|..]] giallo, [[c|..]] celeste, [[r|..]] rosa, [[u|..]] sottolineato, [n] fonte.
function marca(t) {
  return esc(t).replace(/\[\[([gcru])\|([^\]]{1,300})\]\]/g, function (m, k, x) { return '<span class="' + { g: 'hl', c: 'hb', r: 'hr', u: 'ul' }[k] + '">' + x + '</span>'; })
    .replace(/\[p\.\s?(\d{1,4})(?:\s?[-–]\s?(\d{1,4}))?\]/g, function (m, a, b) { return '<button type="button" class="pag" data-pag="' + a + '">' + (FONTI_VIS.tipo === 'parte' ? 'parte ' : 'p. ') + a + (b ? '–' + b : '') + '</button>'; })
    .replace(/\[(\d{1,2})\]/g, function (m, n) { var f = (FONTI_VIS.fonti || []).find(function (x) { return x.n === +n; }); return '<button type="button" class="cit" data-fonte="' + n + '">' + (f ? esc(nomeSito(f)) : '[' + n + ']') + '</button>'; });
}
var FONTI_VIS = {};
function nomeSito(f) { var x = f.sito || String(f.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; return x.length > 22 ? x.slice(0, 21) + '…' : x; }
function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, 2600); }
function nid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function giorno(d) { var x = d ? new Date(d) : new Date(); return x.toLocaleDateString('sv-SE'); }
function traGiorni(n) { var d = new Date(); d.setDate(d.getDate() + n); return giorno(d); }
function api(url, body, metodo) {
  return fetch(url, body ? { method: metodo || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method: metodo || 'GET' })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { j.status = r.status; throw j; } return j; }); });
}

// ---------- stato salvato ----------
var S = (function () { try { return JSON.parse(localStorage.getItem('unilampo') || 'null'); } catch (e) { return null; } })();
if (!S || !S.uid) S = { uid: 'u' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4), materie: [], caricamenti: [], risposte: {}, orali: [], creato: new Date().toISOString() };
['materie', 'caricamenti', 'orali'].forEach(function (k) { if (!Array.isArray(S[k])) S[k] = []; });
if (!S.risposte) S.risposte = {};
var syncT = null;
function salva() {
  S.agg = Date.now();
  try { localStorage.setItem('unilampo', JSON.stringify(S)); } catch (e) {}
  clearTimeout(syncT); syncT = setTimeout(function () { api('/api/dati', { uid: S.uid, data: S }).catch(function () {}); }, 1200);
}
// All'avvio prende la versione più recente tra telefono e server.
api('/api/dati?uid=' + S.uid).then(function (r) { if (r.data && (r.data.agg || 0) > (S.agg || 0)) { S = r.data; try { localStorage.setItem('unilampo', JSON.stringify(S)); } catch (e) {} rerender(); } }).catch(function () {});

var DISP = {};
function dispLocale(cid) { if (DISP[cid]) return DISP[cid]; try { var d = JSON.parse(localStorage.getItem('ul-d-' + cid) || 'null'); if (d) DISP[cid] = d; return d; } catch (e) { return null; } }
function dispSalva(cid, d) { DISP[cid] = d; try { localStorage.setItem('ul-d-' + cid, JSON.stringify(d)); } catch (e) {} }
function dispCarica(cid) {
  var loc = dispLocale(cid);
  return api('/api/caricamento?uid=' + S.uid + '&cid=' + cid).then(function (r) { dispSalva(cid, r.dispensa); return r.dispensa; }).catch(function () { return loc; });
}

// ---------- AI: stato (costi e regole sono solo nel pannello) ----------
var AI = { accesa: false, maxFonti: 3, maxCaratteri: 60000, letto: false };
function leggiStato() { return api('/api/stato').then(function (r) { r.letto = true; AI = r; return r; }).catch(function () { AI.letto = true; return AI; }); }
function genera(cid, passo, extra) { var c = S.caricamenti.find(function (x) { return x.id === cid; }), m = c && materia(c.materiaId); return api('/api/genera', Object.assign({ uid: S.uid, cid: cid, passo: passo, materia: m ? m.nome : '' }, extra || {})); }
var PAUSA = 'Il generatore è in pausa: le dispense già pronte, i test e il ripasso funzionano. Riprova più tardi.';
function erroreAI(e) {
  if (e && (e.error === 'spenta' || e.error === 'tetto')) return PAUSA;
  if (e && e.error === 'incompleta') return 'Non ho finito: mancano alcune parti. Premi «Riprendi» e completo solo quelle.';
  return 'Si è interrotto a metà: premi «Riprendi» e continuo da dove mi sono fermato.';
}


// ---------- navigazione: 3 sezioni, niente pagine dentro pagine ----------
var cur = { view: 'studia', tab: 'studia' }, VIEWS = ['studia', 'dispensa', 'test', 'orale'];
var TABOF = { studia: 'studia', dispensa: 'studia', test: 'test', orale: 'orale' };
function mostra(v, arg) {
  if (cur.view === 'orale' && v !== 'orale') fermaOrale();
  cur.view = v; cur.arg = arg; cur.tab = TABOF[v];
  VIEWS.forEach(function (x) { $('v-' + x).classList.toggle('on', x === v); });
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === cur.tab); });
  ({ studia: vStudia, dispensa: vDispensa, test: vTest, orale: vOrale })[v](arg);
  window.scrollTo(0, 0);
}
function rerender() { var y = window.scrollY; mostra(cur.view, cur.arg); window.scrollTo(0, y); }
document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.tab === 'test') T = null; mostra(b.dataset.tab); }); });
$('go-home').addEventListener('click', function () { mostra('studia'); });
function sheet(html, onOpen) { $('sheet-in').innerHTML = '<div class="grab"></div>' + html; $('sheet').classList.add('on'); document.body.style.overflow = 'hidden'; if (onOpen) onOpen($('sheet-in')); }
function chiudiSheet() { $('sheet').classList.remove('on'); document.body.style.overflow = ''; }
$('sheet').addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) chiudiSheet(); });
document.addEventListener('focusin', function (e) { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) document.body.classList.add('kb'); });
document.addEventListener('focusout', function () { setTimeout(function () { if (!/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) document.body.classList.remove('kb'); }, 50); });
var MATITA = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';

// Materie in alto: le stesse in Studia, Test e Orale.
function materiaCorrente() { if (!S.materie.length) return null; if (!materia(S.ultimaMateria)) S.ultimaMateria = S.materie[0].id; return materia(S.ultimaMateria); }
function barraMaterie(conAggiungi) {
  var m = materiaCorrente();
  return '<div class="mat">' + S.materie.map(function (x) { return '<button type="button" data-mat="' + x.id + '" class="' + (m && x.id === m.id ? 'on' : '') + '">' + esc(x.nome) + '</button>'; }).join('') + (conAggiungi ? '<button type="button" class="add" data-nuova>+ Materia</button>' : '') + '</div>';
}
function legaMaterie(root) {
  root.querySelectorAll('[data-mat]').forEach(function (b) { b.onclick = function () { S.ultimaMateria = b.dataset.mat; salva(); rerender(); }; });
  var n = root.querySelector('[data-nuova]'); if (n) n.onclick = function () { schedaMateria(null); };
}
// Crea o rinomina una materia (ed eliminala).
function schedaMateria(m) {
  sheet('<h2 style="font-size:24px">' + (m ? 'Modifica materia' : 'Nuova materia') + '</h2><div class="field"><label for="nm">Nome della materia</label><input id="nm" maxlength="80" placeholder="es. Diritto privato" autocomplete="off" value="' + esc(m ? m.nome : '') + '"></div>' +
    '<button class="btn" id="nm-ok">' + (m ? 'Salva' : 'Aggiungi') + '</button>' + (m ? '<button class="btn ghost" id="nm-del" style="color:var(--kob)">Elimina materia e dispense</button>' : '') + '<button class="btn ghost" data-close style="color:var(--blu2)">Annulla</button>', function (r) {
    var i = r.querySelector('#nm'); setTimeout(function () { i.focus(); if (m) i.select(); }, 120);
    var ok = function () { var n = i.value.trim(); if (!n) return; if (m) m.nome = n; else { var x = { id: nid('m'), nome: n }; S.materie.push(x); S.ultimaMateria = x.id; } salva(); chiudiSheet(); rerender(); };
    r.querySelector('#nm-ok').onclick = ok; i.onkeydown = function (e) { if (e.key === 'Enter') ok(); };
    r.querySelector('[data-close]').onclick = chiudiSheet;
    var d = r.querySelector('#nm-del'); if (d) d.onclick = function () {
      if (!confirm('Eliminare ' + m.nome + ' con tutte le sue dispense?')) return;
      carDi(m.id).forEach(function (c) { api('/api/caricamento?uid=' + S.uid + '&cid=' + c.id, null, 'DELETE').catch(function () {}); try { localStorage.removeItem('ul-d-' + c.id); } catch (e) {} });
      S.caricamenti = S.caricamenti.filter(function (c) { return c.materiaId !== m.id; }); S.materie = S.materie.filter(function (x) { return x.id !== m.id; }); salva(); chiudiSheet(); rerender();
    };
  });
}

// ---------- PIANO: data dell'esame, cosa fare oggi, quanto sei pronta ----------
function giorniA(data) { if (!data) return null; var a = new Date(giorno() + 'T00:00:00'), b = new Date(data + 'T00:00:00'); return Math.round((b - a) / 86400000); }
function capitoliMateria(mid) { // [{cid, i, titolo}] di tutte le dispense complete
  var o = []; carDi(mid).forEach(function (c) { var d = dispLocale(c.id); if (!d || !partiDi(c).dispensa) return; d.argomenti.forEach(function (a, i) { if (d.capitoli[i]) o.push({ cid: c.id, i: i, titolo: d.capitoli[i].titolo }); }); });
  return o;
}
function letto(cid, i) { return !!(S.letti && S.letti[cid + ':' + i]); }
function piano(m) {
  var caps = capitoliMateria(m.id), daLeggere = caps.filter(function (x) { return !letto(x.cid, x.i); }), qs = domandeMateria(m.id);
  var sapute = qs.filter(function (x) { var r = S.risposte[x.qid]; return r && r.box >= 2; }).length, gg = giorniA(m.esame);
  var perOggi = daLeggere.length ? (gg === null ? Math.min(2, daLeggere.length) : Math.min(daLeggere.length, Math.max(1, Math.ceil(daLeggere.length / Math.max(1, gg - 3))))) : 0;
  return { caps: caps, daLeggere: daLeggere, perOggi: perOggi, qs: qs, sapute: sapute, gg: gg, due: daRipassare(m.id) };
}
function boxPiano(m) {
  var p = piano(m), h = '<div class="oggi"><div class="flex"><span class="lab">Oggi</span>' +
    (p.gg === null ? '<button class="linkap" data-esame>📅 Quando hai l\'esame?</button>' : '<button class="pillx" data-esame>' + (p.gg > 1 ? 'Esame tra ' + p.gg + ' giorni' : p.gg === 1 ? 'Esame domani' : p.gg === 0 ? 'Esame oggi' : 'Esame passato') + ' · ' + giornoIt(m.esame) + '</button>') + '</div>';
  var cose = [];
  if (p.perOggi) cose.push('<button class="todo" data-leggi="' + p.daLeggere[0].cid + ':' + p.daLeggere[0].i + '"><i>📖</i><span><b>Studia ' + (p.perOggi === 1 ? '1 capitolo' : p.perOggi + ' capitoli') + '</b><small>Inizia da: ' + esc(p.daLeggere[0].titolo) + '</small></span><em>→</em></button>');
  if (p.due.length) cose.push('<button class="todo" data-rip2><i>🔁</i><span><b>Ripassa ' + p.due.length + (p.due.length === 1 ? ' domanda sbagliata' : ' domande sbagliate') + '</b><small>Tornano finché non le sai</small></span><em>→</em></button>');
  if (p.qs.length >= 10 && (!p.daLeggere.length || (p.gg !== null && p.gg <= 7))) cose.push('<button class="todo" data-sim2><i>⏱️</i><span><b>Simulazione d\'esame</b><small>' + Math.min(30, p.qs.length) + ' domande a tempo, voto in trentesimi</small></span><em>→</em></button>');
  else if (p.qs.length) cose.push('<button class="todo" data-test2><i>✅</i><span><b>Test veloce</b><small>15 domande, prima quelle che sai meno</small></span><em>→</em></button>');
  if (!cose.length) cose.push('<span class="note">Carica il primo PDF: qui comparirà cosa fare ogni giorno.</span>');
  h += cose.join('');
  if (p.caps.length || p.qs.length) h += '<div class="pronta">' +
    (p.caps.length ? '<div><span>Capitoli studiati</span><b>' + (p.caps.length - p.daLeggere.length) + ' / ' + p.caps.length + '</b><div class="bar"><i style="width:' + Math.round((p.caps.length - p.daLeggere.length) / p.caps.length * 100) + '%"></i></div></div>' : '') +
    (p.qs.length ? '<div><span>Domande che sai</span><b>' + p.sapute + ' / ' + p.qs.length + '</b><div class="bar"><i style="width:' + Math.round(p.sapute / p.qs.length * 100) + '%"></i></div></div>' : '') + '</div>';
  return h + '</div>';
}
function legaPiano(v, m) {
  var e = v.querySelector('[data-esame]'); if (e) e.onclick = function () { schedaEsame(m); };
  var l = v.querySelector('[data-leggi]'); if (l) l.onclick = function () { var q = l.dataset.leggi.split(':'); mostra('dispensa', q[0]); setTimeout(function () { var x = $('cap' + q[1]); if (x) x.scrollIntoView({ block: 'start' }); }, 80); };
  var r = v.querySelector('[data-rip2]'); if (r) r.onclick = function () { avviaTest({ tipo: 'ripasso', mid: m.id }); };
  var s = v.querySelector('[data-sim2]'); if (s) s.onclick = function () { avviaTest({ tipo: 'simulazione', mid: m.id }); };
  var t = v.querySelector('[data-test2]'); if (t) t.onclick = function () { avviaTest({ tipo: 'materia', mid: m.id }); };
}
function schedaEsame(m) {
  sheet('<h2 style="font-size:22px">Quando hai l\'esame di ' + esc(m.nome) + '?</h2><span style="font-size:14px">Con la data, ogni giorno ti dico quanti capitoli studiare per arrivare pronta, lasciando gli ultimi giorni per ripasso e simulazioni.</span><div class="field"><label for="es-d">Data dell\'esame</label><input id="es-d" type="date" min="' + giorno() + '" value="' + esc(m.esame || '') + '"></div><button class="btn" id="es-ok">Salva</button>' + (m.esame ? '<button class="btn ghost" id="es-via" style="color:var(--kob)">Togli la data</button>' : '') + '<button class="btn ghost" data-close style="color:var(--blu2)">Annulla</button>', function (r) {
    r.querySelector('[data-close]').onclick = chiudiSheet;
    r.querySelector('#es-ok').onclick = function () { var x = $('es-d').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return toast('Scegli una data.'); m.esame = x; salva(); chiudiSheet(); rerender(); };
    var via = r.querySelector('#es-via'); if (via) via.onclick = function () { delete m.esame; salva(); chiudiSheet(); rerender(); };
  });
}
function segnaLetto(cid, i) {
  if (!S.letti) S.letti = {};
  if (S.letti[cid + ':' + i]) delete S.letti[cid + ':' + i]; else S.letti[cid + ':' + i] = giorno();
  salva();
}

// ---------- CERCA in tutte le dispense ----------
function pulito(t) { return String(t || '').replace(/\[\[[gcru]\|([^\]]*)\]\]/g, '$1').replace(/\s*\[p\.[^\]]*\]|\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim(); }
function senzaAccenti(t) { return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function indiceRicerca() { // [{cid, tipo, dove, testo, cap, k}]
  var out = [];
  S.caricamenti.forEach(function (c) {
    var d = dispLocale(c.id); if (!d) return;
    var mat = (materia(c.materiaId) || {}).nome || '', tit = c.titolo || d.titolo || '';
    var add = function (tipo, dove, testo, cap, k) { testo = pulito(testo); if (testo) out.push({ cid: c.id, mat: mat, disp: tit, tipo: tipo, dove: dove, testo: testo, cap: cap, k: k }); };
    Object.keys(d.capitoli || {}).forEach(function (i) {
      var cp = d.capitoli[i], nome = 'Cap. ' + (+i + 1) + ' · ' + cp.titolo;
      add('Titolo', nome, cp.titolo, +i, -1);
      (cp.paragrafi || []).forEach(function (p, k) { add('Capitolo', nome, p, +i, k); });
      if (cp.esempio) add('Esempio', nome, cp.esempio, +i, 'es');
      if (cp.trappola) add('Trappola', nome, cp.trappola, +i, 'tr');
      if (cp.ricorda) add('Da ricordare', nome, cp.ricorda, +i, 'rem');
    });
    if (d.mappa) (d.mappa.rami || []).forEach(function (r, n) { add('Mappa', 'Mappa · ' + r.titolo, r.titolo + ': ' + r.testo + ' · ' + (r.foglie || []).join(' · '), 'mappa', n); });
    Object.keys(d.approfondimenti || {}).forEach(function (key) { var a = d.approfondimenti[key]; (a.paragrafi || []).forEach(function (p) { add('Approfondimento', 'Approfondimento · ' + a.titolo, p, a.capitolo || 0, -1); }); });
    Object.keys(d.domande || {}).forEach(function (i) { ((d.domande[i] || {}).crocette || []).forEach(function (q) { add('Domanda', 'Domanda · ' + titoloCap(c.id, +i), q.testo + ' → ' + q.opzioni[q.giusta], +i, -1); }); });
    if (!partiDi(c).dispensa) (d.argomenti || []).forEach(function (a, i) { add('Argomento', 'Argomento ' + (i + 1), a.titolo + ': ' + (a.descrizione || ''), 'top', -1); });
  });
  return out;
}
function trova(q) {
  var parole = senzaAccenti(q).split(/\s+/).filter(function (w) { return w.length > 1; }); if (!parole.length) return [];
  return indiceRicerca().map(function (x) {
    var t = senzaAccenti(x.testo), ok = parole.every(function (w) { return t.indexOf(w) >= 0; }); if (!ok) return null;
    var punti = parole.reduce(function (s, w) { return s + (t.split(w).length - 1); }, 0) + (x.tipo === 'Titolo' ? 5 : x.tipo === 'Mappa' ? 2 : 0);
    return { x: x, punti: punti };
  }).filter(Boolean).sort(function (a, b) { return b.punti - a.punti; }).slice(0, 40).map(function (r) { return r.x; });
}
function evidenzia(testo, q) {
  var parole = senzaAccenti(q).split(/\s+/).filter(function (w) { return w.length > 1; }), t = senzaAccenti(testo), primo = -1;
  parole.forEach(function (w) { var i = t.indexOf(w); if (i >= 0 && (primo < 0 || i < primo)) primo = i; });
  var da = Math.max(0, primo - 60); if (da) { var sp = testo.indexOf(' ', da); if (sp > 0 && sp < primo) da = sp + 1; }
  var pezzo = (da ? '…' : '') + testo.slice(da, da + 200) + (testo.length > da + 200 ? '…' : ''), tp = senzaAccenti(pezzo), out = '', i = 0;
  var segni = []; parole.forEach(function (w) { var j = 0; while ((j = tp.indexOf(w, j)) >= 0) { segni.push([j, j + w.length]); j += w.length; } });
  segni.sort(function (a, b) { return a[0] - b[0]; });
  segni.forEach(function (s) { if (s[0] < i) return; out += esc(pezzo.slice(i, s[0])) + '<mark>' + esc(pezzo.slice(s[0], s[1])) + '</mark>'; i = s[1]; });
  return out + esc(pezzo.slice(i));
}
function apriCerca(iniziale) {
  Promise.all(S.caricamenti.map(function (c) { return dispLocale(c.id) ? null : dispCarica(c.id).catch(function () {}); }));
  sheet('<h2 style="font-size:22px">Cerca nelle tue dispense</h2><div class="cerca-in"><span>🔍</span><input id="q" type="search" placeholder="es. elasticità, contratto, Freud…" autocomplete="off" value="' + esc(iniziale || '') + '"></div><div id="q-ris" class="q-ris"></div><button class="btn ghost" data-close style="color:var(--blu2)">Chiudi</button>', function (r) {
    r.querySelector('[data-close]').onclick = chiudiSheet;
    var i = $('q'), mostraRis = function () {
      var q = i.value.trim(), box = $('q-ris'); if (!box) return;
      if (q.length < 2) { box.innerHTML = '<span class="note">Cerca una parola o un concetto in capitoli, mappe, approfondimenti e domande di tutte le materie.</span>'; return; }
      var ris = trova(q);
      box.innerHTML = ris.length ? '<span class="note">' + ris.length + (ris.length === 40 ? '+' : '') + ' risultati</span>' + ris.map(function (x, n) { return '<button class="q-r" data-n="' + n + '"><span class="q-dove"><b>' + esc(x.mat) + '</b> · ' + esc(x.disp) + '</span><span class="q-t">' + esc(x.dove) + ' <i>' + x.tipo + '</i></span><span class="q-s">' + evidenzia(x.testo, q) + '</span></button>'; }).join('') : '<div class="empty" style="padding:18px"><b>Nessun risultato</b><span>Prova con un\'altra parola o con meno parole.</span></div>';
      box.querySelectorAll('[data-n]').forEach(function (b) { b.onclick = function () { vaiA(ris[+b.dataset.n]); }; });
    };
    i.oninput = function () { clearTimeout(i.t); i.t = setTimeout(mostraRis, 120); };
    mostraRis(); setTimeout(function () { i.focus(); }, 150);
  });
}
function vaiA(x) {
  chiudiSheet(); mostra('dispensa', x.cid);
  setTimeout(function () {
    var el = x.cap === 'mappa' ? (document.querySelector('#v-dispensa .node[data-k="' + x.k + '"]') || document.querySelector('#v-dispensa .paper.mappa')) : x.cap === 'top' ? document.querySelector('#v-dispensa .paper') : (typeof x.k === 'number' && x.k >= 0 ? $('c' + x.cap + 'p' + x.k) : null) || $('cap' + x.cap);
    if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('lampo'); void el.offsetWidth; el.classList.add('lampo');
  }, 120);
}

// ---------- TEMA chiaro / scuro ----------
function temaScelto() { try { return localStorage.getItem('ul-tema') || 'auto'; } catch (e) { return 'auto'; } }
function applicaTema() {
  var t = temaScelto(), scuro = t === 'scuro' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('scuro', scuro);
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', scuro ? '#0B1530' : '#E4F2FC');
  var map = document.querySelector('#v-dispensa .map'); if (map) lineeMappa(map);
}
function impostaTema(t) { try { localStorage.setItem('ul-tema', t); } catch (e) {} applicaTema(); }
applicaTema();
if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', applicaTema); }

// ---------- STUDIA ----------
function vStudia() {
  var v = $('v-studia'), m = materiaCorrente(), h = '';
  if (!m) {
    v.innerHTML = '<h1 class="h1">Cosa studi?</h1><div class="hero"><span class="lab">Primo passo</span><h2>Aggiungi una materia</h2><span style="font-size:14.5px;color:#D6E6F5">Poi carichi gli appunti: UniLampo prepara la dispensa con mappa, fonti verificate, test e orale.</span>' +
      '<div class="field"><input id="pm" maxlength="80" placeholder="es. Microeconomia" autocomplete="off" style="border-color:transparent"></div><button class="btn" id="pm-ok">Aggiungi</button></div>';
    var add = function () { var n = $('pm').value.trim(); if (!n) return; var x = { id: nid('m'), nome: n }; S.materie.push(x); S.ultimaMateria = x.id; salva(); vStudia(); };
    $('pm-ok').onclick = add; $('pm').onkeydown = function (e) { if (e.key === 'Enter') add(); };
    return;
  }
  var st = statMateria(m.id), car = carDi(m.id).slice().reverse(), nq = domandeMateria(m.id).length, due = daRipassare(m.id);
  h += barraMaterie(true);
  if (S.caricamenti.length) h += '<button type="button" class="cerca" data-cerca><span>🔍</span>Cerca in tutte le dispense</button>';
  h += '<div class="hero"><div class="flex"><span class="lab">Materia</span></div><h2>' + esc(m.nome) + '<button class="ed" type="button" data-ed aria-label="Modifica nome">' + MATITA + '</button></h2>' +
    '<div class="stat"><div><b>' + (st.pct === null ? '–' : st.pct + '%') + '</b><span>risposte giuste</span></div><div><b>' + (function (k) { return k + '</b><span>' + (k === 1 ? 'dispensa' : 'dispense'); })(car.filter(function (c) { return c.stato === 'pronta'; }).length) + '</span></div><div><b>' + nq + '</b><span>' + (nq === 1 ? 'domanda' : 'domande') + '</span></div></div></div>';
  h += boxPiano(m);
  h += '<label class="up"><input type="file" id="up-file" accept=".pdf,.txt,.md,application/pdf,text/plain"><span class="plus">+</span><span><b>Carica appunti</b><span>PDF o testo · dispensa, test o mappa: scegli tu</span></span></label>';
  h += '<button class="linkap" data-incolla style="align-self:center">oppure incolla il testo</button>';
  h += boxNotifiche();
  if (car.length) h += '<div class="sez">Dispense <small>' + car.length + '</small></div>';
  car.forEach(function (c) { h += cartaDispensa(c); });
  if (!car.length) h += '<div class="empty"><b>Nessuna dispensa per ' + esc(m.nome) + '</b><span>Carica il primo PDF di appunti: in circa un minuto hai capitoli spiegati, mappa a colori, fonti e domande.</span></div>';
  h += '<div class="foot"><span class="tema" role="group" aria-label="Tema">' + [['auto', 'Automatico'], ['chiaro', 'Chiaro'], ['scuro', 'Scuro']].map(function (t) { return '<button type="button" data-tema="' + t[0] + '" class="' + (temaScelto() === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</span><span>Il tuo codice: <b style="user-select:all">' + esc(S.uid) + '</b></span><button type="button" data-codice>Usa i tuoi dati su un altro telefono</button></div>';
  v.innerHTML = h;
  legaMaterie(v);
  v.querySelector('[data-ed]').onclick = function () { schedaMateria(m); };
  legaPiano(v, m);
  var cb = v.querySelector('[data-cerca]'); if (cb) cb.onclick = function () { apriCerca(); };
  $('up-file').onchange = function (e) { var f = e.target.files[0]; if (f) caricaFile(m, f); e.target.value = ''; };
  v.querySelector('[data-incolla]').onclick = function () { incolla(m); };
  var nb = v.querySelector('[data-notif]'); if (nb) nb.onclick = attivaNotifiche;
  v.querySelector('[data-codice]').onclick = schedaCodice;
  v.querySelectorAll('[data-tema]').forEach(function (b) { b.onclick = function () { impostaTema(b.dataset.tema); rerender(); }; });
  v.querySelectorAll('[data-apri]').forEach(function (b) { b.onclick = function () { mostra('dispensa', b.dataset.apri); }; });
  v.querySelectorAll('[data-test]').forEach(function (b) { b.onclick = function () { avviaTest({ tipo: 'verifica', cid: b.dataset.test }); }; });
  v.querySelectorAll('[data-orale]').forEach(function (b) { b.onclick = function () { S.ultimaMateria = m.id; S.oraleCid = b.dataset.orale; salva(); mostra('orale'); }; });
  v.querySelectorAll('[data-agg]').forEach(function (b) { b.onclick = function () { aggiungiParte(b.dataset.agg); }; });
  v.querySelectorAll('[data-riprendi]').forEach(function (b) { b.onclick = function () { var c = S.caricamenti.find(function (x) { return x.id === b.dataset.riprendi; }); if (c) prepara(c); }; });
}
// Elenco delle fasi con spunte: si vede sempre a che punto è e, se si ferma, dove.
function fasi(j) {
  var k = j.conta || {}, n = k.n || 0, err = !!j.errore, p = j.parti || { dispensa: true }, righe = [
    ['Argomenti', k.argomenti ? 'trovati: ' + n : '', k.argomenti ? 1 : 0, 1, true],
    ['Fonti affidabili', n ? (k.fonti || 0) + ' di ' + n : '', k.fonti || 0, n || 1, p.dispensa],
    ['Capitoli', n ? (k.capitoli || 0) + ' di ' + n : '', k.capitoli || 0, n || 1, p.dispensa],
    ['Domande', n ? (k.domande || 0) + ' di ' + n : '', k.domande || 0, n || 1, p.dispensa || p.test],
    ['Mappa', '', k.mappa || 0, 1, p.dispensa || p.mappa]].filter(function (r) { return r[4]; }), primoAperto = -1;
  righe.forEach(function (r, i) { if (primoAperto < 0 && r[2] < r[3]) primoAperto = i; });
  return '<div class="steps">' + righe.map(function (r, i) {
    var fatto = r[2] >= r[3], ora = i === primoAperto, cl = fatto ? 'fatto' : ora ? (err ? 'err' : 'ora') : '';
    return '<div class="' + cl + '"><i>' + (fatto ? '✓' : ora ? (err ? '!' : '…') : i + 1) + '</i><span><b>' + r[0] + '</b>' + (r[1] ? ' · ' + r[1] : '') + (ora && err ? ' · <b style="color:var(--kob)">si è fermato qui</b>' : '') + '</span></div>';
  }).join('') + '</div>';
}
function cartaDispensa(c) {
  var j = JOBS[c.id], d = dispLocale(c.id), nCap = d ? Object.keys(d.capitoli || {}).length : 0, nArg = d ? d.argomenti.length : 0;
  if (c.stato === 'pronta') {
    var nq = domandeDi(c.id).length, p = partiDi(c), et = etichettaParti(p), nRami = d && d.mappa ? d.mappa.rami.length : 0;
    var info = p.dispensa ? nCap + (nCap === 1 ? ' capitolo' : ' capitoli') + (d && d.pagine ? ' da ' + d.pagine + (d.tipoPagine === 'parte' ? ' parti' : ' pagine') : '') + ' · ' + nq + ' domande' : [nq ? nq + ' domande' : '', nRami ? 'mappa: ' + nRami + ' rami' : ''].filter(Boolean).join(' · ');
    var agg = p.dispensa ? '' : '<div class="row" style="gap:14px">' + (!p.test ? '<button class="linkap" data-agg="' + c.id + ':test">+ Aggiungi il test</button>' : '') + (!p.mappa ? '<button class="linkap" data-agg="' + c.id + ':mappa">+ Aggiungi la mappa</button>' : '') + '<button class="linkap" data-agg="' + c.id + ':dispensa" style="color:var(--blu2)">crea la dispensa completa</button></div>';
    return '<div class="dc"><button class="tt" data-apri="' + c.id + '"><span><h3>' + esc(c.titolo) + '</h3><span class="note">' + (et ? '<span class="tag grey" style="margin-right:6px">' + et + '</span>' : '') + info + '</span></span><span class="go">›</span></button>' +
      (nq ? '<div class="row"><button class="btn v small" data-test="' + c.id + '">Test</button><button class="btn ghost small" data-orale="' + c.id + '" style="color:var(--blu)">Orale</button></div>' : '') + agg + '</div>';
  }
  var pct = j ? Math.round(j.fatti / Math.max(1, j.totali) * 100) : 0, testo = j ? (j.errore ? j.errore : j.fase) : 'Preparazione interrotta';
  return '<div class="dc lav"><div class="tt"><span><h3>' + esc(c.titolo) + '</h3><span class="note">' + esc(j && j.errore ? 'Si è fermato: ' + j.errore : testo) + '</span></span>' + (j && !j.errore ? '<span class="spin"></span>' : '') + '</div>' + (j ? fasi(j) : '') +
    '<div class="bar"><i style="width:' + pct + '%"></i></div>' + (j && !j.errore ? '<span class="note">Puoi anche chiudere l\'app: continuo io. Quando torni la trovi qui.</span>' : '') +
    (nCap ? '<button class="btn small" data-apri="' + c.id + '">Inizia a leggere →</button>' : '') +
    (!j || j.errore ? '<button class="btn v small" data-riprendi="' + c.id + '"' + (AI.accesa ? '' : ' disabled') + '>Riprendi da dove si è fermata</button>' + (AI.accesa ? '' : notaAI()) : '') + '</div>';
}
function aggiungiParte(x) {
  var q = x.split(':'), c = S.caricamenti.find(function (k) { return k.id === q[0]; }); if (!c) return;
  if (!AI.accesa) return toast(PAUSA);
  var o = {}; o[q[1]] = true; prepara(c, o);
  if (cur.view === 'dispensa') mostra('studia');
}
function usaCodiceNuovo(c) {
  c = c || ('u' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4));
  S = { uid: c, materie: [], caricamenti: [], risposte: {}, orali: [], creato: new Date().toISOString() };
  JOBS = {}; SEGUO = {}; salva(); chiudiSheet(); toast('Il tuo codice ora è ' + c); mostra('studia');
}
function schedaCodice() {
  sheet('<h2 style="font-size:22px">Il tuo codice</h2><span style="font-size:14px">Con questo codice ritrovi materie, dispense e progressi su un altro telefono.</span><b style="font-family:\'Bricolage Grotesque\';font-size:22px;user-select:all">' + esc(S.uid) + '</b>' +
    '<div class="field"><label for="s-cod">Usa un altro codice</label><input id="s-cod" placeholder="u…" autocomplete="off" autocapitalize="off"></div><button class="btn" id="s-usa">Passa a questo codice</button><button class="btn ghost" id="s-nuovo" style="color:var(--blu)">Crea un codice nuovo, vuoto</button><span class="note" style="font-size:12.5px">Cambiando codice, i dati del codice di prima restano salvati: chi ha quel codice li ritrova.</span><button class="btn ghost" data-close style="color:var(--blu2)">Chiudi</button>', function (r) {
    r.querySelector('[data-close]').onclick = chiudiSheet;
    r.querySelector('#s-nuovo').onclick = function () { if (confirm('Crei un codice nuovo e riparti da zero su questo telefono?')) usaCodiceNuovo(); };
    r.querySelector('#s-usa').onclick = function () {
      var c = $('s-cod').value.trim().toLowerCase(); if (!/^u[a-z0-9]{8,30}$/.test(c)) return toast('Codice non valido.');
      api('/api/dati?uid=' + c).then(function (x) { if (!x.data) { if (confirm('Nessun dato con il codice ' + c + '. Lo uso come tuo codice nuovo, partendo da zero?')) usaCodiceNuovo(c); return; } S = x.data; S.uid = c; try { localStorage.setItem('unilampo', JSON.stringify(S)); } catch (e) {} chiudiSheet(); toast('Fatto: dati caricati'); S.caricamenti.forEach(function (k) { dispCarica(k.id).then(function () { if (cur.view === 'studia') rerender(); }); }); mostra('studia'); }).catch(function () { toast('Non riesco a controllare il codice.'); });
    };
  });
}
// Cosa preparare dal testo caricato: dispensa completa, solo test, solo mappa, test + mappa.
function partiDi(c) { return (c && c.parti) || { dispensa: true }; }
function etichettaParti(p) { return p.dispensa ? '' : p.test && p.mappa ? 'Test + mappa' : p.test ? 'Solo test' : 'Solo mappa'; }
function scegliParti(nome, fatto) {
  var scelte = [['dispensa', '📘', 'Dispensa completa', 'Capitoli spiegati, fonti verificate, mappa, test e orale.'], ['test', '✅', 'Solo test', 'Domande a crocette e per l\'orale, direttamente dal testo. Ideale se è già una dispensa.'], ['mappa', '🗺️', 'Solo mappa', 'Una mappa a colori dei concetti principali.'], ['testmappa', '🧩', 'Test + mappa', 'Le due cose insieme, senza riscrivere il testo.']], sel = 'dispensa';
  var disegna = function (r) {
    r.querySelector('#sp-opts').innerHTML = scelte.map(function (x) { var on = x[0] === sel; return '<button type="button" class="dc" data-sp="' + x[0] + '" style="flex-direction:row;align-items:center;gap:14px;text-align:left;border:2px solid ' + (on ? 'var(--blu)' : 'var(--soft)') + ';' + (on ? 'background:var(--card2);' : '') + 'color:var(--ink);padding:13px 14px"><span style="font-size:28px">' + x[1] + '</span><span style="flex:1"><b style="font-size:16.5px;font-family:\'Bricolage Grotesque\'">' + x[2] + '</b><br><span class="note" style="font-size:13px">' + x[3] + '</span></span><span style="flex:none;width:24px;height:24px;border-radius:50%;border:2px solid var(--blu);' + (on ? 'background:var(--blu);box-shadow:inset 0 0 0 4px #fff;' : '') + '"></span></button>'; }).join('');
    r.querySelectorAll('[data-sp]').forEach(function (b) { b.onclick = function () { sel = b.dataset.sp; disegna(r); }; });
  };
  sheet('<span class="lab">' + esc(nome) + '</span><h2 style="font-size:24px">Cosa ti serve?</h2><div id="sp-opts" style="display:flex;flex-direction:column;gap:9px"></div><button class="btn" id="sp-ok">Prepara</button><button class="btn ghost" data-close style="color:var(--blu2)">Annulla</button>', function (r) {
    disegna(r); r.querySelector('[data-close]').onclick = chiudiSheet;
    r.querySelector('#sp-ok').onclick = function () { chiudiSheet(); fatto(sel === 'dispensa' ? { dispensa: true } : sel === 'test' ? { test: true } : sel === 'mappa' ? { mappa: true } : { test: true, mappa: true }); };
  });
}
function incolla(m) {
  sheet('<h2 style="font-size:22px">Incolla gli appunti</h2><textarea class="in" id="ic" rows="9" placeholder="Incolla qui il testo"></textarea><button class="btn" id="ic-ok">Avanti</button><button class="btn ghost" data-close style="color:var(--blu2)">Annulla</button>', function (r) {
    r.querySelector('[data-close]').onclick = chiudiSheet;
    r.querySelector('#ic-ok').onclick = function () { var t = $('ic').value.trim(); if (t.length < 200) return toast('Il testo è troppo corto.'); chiudiSheet(); setTimeout(function () { scegliParti('Testo incollato', function (p) { nuovoCaricamento(m, t, '', 'Appunti incollati', p); }); }, 250); };
  });
}
function caricaFile(m, f) {
  toast('Leggo ' + f.name + '…');
  leggiFile(f).then(function (r) {
    if (r.testo.replace(/\[\[PAGINA \d+\]\]/g, '').trim().length < 200) { sheet('<h2 style="font-size:21px">Testo non trovato</h2><span style="font-size:14.5px">Questo PDF sembra una scansione (immagini, non testo). Per ora UniLampo legge solo PDF con testo selezionabile: prova a esportarlo di nuovo, oppure incolla il testo.</span><button class="btn" data-close>Ho capito</button>', function (x) { x.querySelector('[data-close]').onclick = chiudiSheet; }); return; }
    scegliParti(f.name + (r.pagine ? ' · ' + r.pagine + (r.pagine === 1 ? ' pagina' : ' pagine') : ''), function (p) { nuovoCaricamento(m, r.testo, f.name, f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 100), p); });
  }).catch(function () { toast('Non riesco a leggere il file.'); });
}
function nuovoCaricamento(m, testo, file, titolo, parti) {
  if (!AI.accesa) { toast(PAUSA); }
  var cid = nid('c');
  parti = parti || { dispensa: true };
  api('/api/caricamento', { uid: S.uid, cid: cid, materia: m.nome, titolo: titolo, file: file, testo: testo, parti: parti }).then(function (r) {
    var c = { id: cid, materiaId: m.id, titolo: titolo, file: file, data: new Date().toISOString(), caratteri: r.caratteri, stato: 'nuovo', parti: parti };
    S.caricamenti.push(c); salva();
    if (r.tagliato) sheet('<h2 style="font-size:21px">File molto lungo</h2><span style="font-size:14.5px">Leggo le pagine da 1 a ' + r.pagine + ' su ' + r.pagineTotali + '. Per le pagine da ' + (r.pagine + 1) + ' in poi carica un secondo file: così ogni pagina finisce nella dispensa, senza tagli.</span><button class="btn" data-close>Ho capito</button>', function (x) { x.querySelector('[data-close]').onclick = chiudiSheet; });
    if (AI.accesa) prepara(c); else rerender();
  }).catch(function (e) { toast(e && e.error === 'corto' ? 'Il testo è troppo corto.' : 'Non riesco a salvare: controlla la connessione.'); });
}

// ---------- preparazione della dispensa, in parallelo ----------
var JOBS = {};
function aggiornaVista() { if (cur.view === 'studia' || (cur.view === 'dispensa')) rerender(); }
function aParti(lista, quanti, fn) { // esegue fn su ogni elemento, al massimo `quanti` alla volta
  var i = 0, err = null;
  return new Promise(function (ok, ko) {
    var attivi = 0;
    var avanti = function () {
      if (err) return;
      if (i >= lista.length && attivi === 0) return ok();
      while (attivi < quanti && i < lista.length) { var x = lista[i++]; attivi++; fn(x).then(function () { attivi--; avanti(); }, function (e) { err = e; ko(e); }); }
    };
    avanti();
  });
}
// Di base la dispensa la prepara il server, in background: continua anche ad app chiusa.
// Se il background non parte, la prepara il telefono (riserva).
var SEGUO = {};
function prepara(c, aggiungi) {
  if (JOBS[c.id] && !JOBS[c.id].errore) return;
  var p = partiDi(c); aggiungi = aggiungi || {};
  c.parti = { dispensa: !!(p.dispensa || aggiungi.dispensa), test: !!(p.test || aggiungi.test), mappa: !!(p.mappa || aggiungi.mappa) };
  c.stato = 'nuovo'; if (Object.keys(aggiungi).length) c.dopo = Date.now(); else delete c.dopo; salva();
  JOBS[c.id] = { fase: 'Avvio la preparazione…', fatti: 0, totali: 10, errore: '', parti: c.parti }; aggiornaVista();
  var m = materia(c.materiaId);
  fetch('/api/prepara', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: S.uid, cid: c.id, materia: m ? m.nome : '', parti: c.parti }) })
    .then(function (r) { if (r.status === 202 || r.ok) setTimeout(function () { segui(c); }, 2500); else { delete JOBS[c.id]; preparaQui(c); } })
    .catch(function () { delete JOBS[c.id]; preparaQui(c); });
}
// Controlla ogni pochi secondi a che punto è il lavoro sul server.
function segui(c) {
  if (SEGUO[c.id]) return; SEGUO[c.id] = true;
  var giro = function () {
    dispCarica(c.id).then(function (d) {
      var L = d && d.lavoro;
      if (L && c.dopo && (L.inizio || 0) < c.dopo - 15000) L = null; // è il lavoro precedente: aspetto quello nuovo
      if (d && d.titolo && (c.titolo === c.file || c.titolo === String(c.file || '').replace(/\.[a-z0-9]+$/i, '') || c.titolo === 'Appunti incollati')) { c.titolo = d.titolo; salva(); }
      if (!L) { SEGUO[c.id] = (SEGUO[c.id] === true ? 1 : SEGUO[c.id] + 1); if (SEGUO[c.id] > 15) { SEGUO[c.id] = false; return; } setTimeout(giro, 3000); return; } // il server sta ancora partendo
      if (L.fine) { c.stato = 'pronta'; if (L.parti) c.parti = L.parti; delete c.dopo; salva(); delete JOBS[c.id]; SEGUO[c.id] = false; toast('Pronto: ' + c.titolo); aggiornaVista(); return; }
      if (L.errore) { c.stato = 'parziale'; salva(); JOBS[c.id] = { fase: L.dove || L.fase, fatti: L.fatti, totali: L.totali, conta: L.conta, parti: L.parti, errore: erroreAI({ error: L.errore }) }; SEGUO[c.id] = false; aggiornaVista(); return; }
      if (Date.now() - (L.agg || 0) > 5 * 60000) { c.stato = 'parziale'; salva(); JOBS[c.id] = { fase: L.fase, fatti: L.fatti, totali: L.totali, conta: L.conta, parti: L.parti, errore: 'La preparazione si è interrotta.' }; SEGUO[c.id] = false; aggiornaVista(); return; }
      JOBS[c.id] = { fase: L.fase, fatti: L.fatti, totali: L.totali, conta: L.conta, parti: L.parti, errore: '' }; aggiornaVista();
      setTimeout(giro, 4000);
    }).catch(function () { setTimeout(giro, 6000); });
  };
  giro();
}
function preparaQui(c) {
  if (JOBS[c.id] && !JOBS[c.id].errore) return;
  var j = JOBS[c.id] = { fase: 'Leggo gli argomenti…', fatti: 0, totali: 10, errore: '' };
  var ricarica = function () { return dispCarica(c.id); };
  var passo = function (nome, extra) { return genera(c.id, nome, extra).then(function (r) { j.fatti++; return r; }); };
  aggiornaVista();
  dispCarica(c.id).then(function (d) {
    d = d || { argomenti: [] };
    return (d.argomenti.length ? Promise.resolve(d) : passo('argomenti').then(function (r) { if (r.dato.titolo && (c.titolo === c.file || c.titolo === String(c.file || '').replace(/\.[a-z0-9]+$/i, '') || c.titolo === 'Appunti incollati')) c.titolo = r.dato.titolo; salva(); return ricarica(); }));
  }).then(function (d) {
    var n = d.argomenti.length, idx = d.argomenti.map(function (a, i) { return i; }), P = partiDi(c);
    j.parti = P;
    if (!P.dispensa) { // solo test e/o mappa, direttamente dal testo
      j.totali = 1 + (P.test ? n : 0) + (P.mappa ? 1 : 0); j.fatti = 1; j.fase = P.test ? 'Preparo le domande…' : 'Disegno la mappa…'; aggiornaVista();
      return (P.test ? aParti(idx.filter(function (i) { return !d.domande[i]; }), 4, function (i) { return passo('domandeT', { indice: i }).then(aggiornaVista); }) : Promise.resolve())
        .then(function () { if (!P.mappa || d.mappa) return; j.fase = 'Disegno la mappa…'; aggiornaVista(); return passo('mappaT'); }).then(ricarica);
    }
    j.totali = 1 + n * 3 + 1; j.fatti = 1 + Object.keys(d.ricerca).length + Object.keys(d.capitoli).length + Object.keys(d.domande).length + (d.mappa ? 1 : 0);
    j.fase = 'Cerco fonti affidabili per ' + n + (n === 1 ? ' argomento…' : ' argomenti…'); aggiornaVista();
    return aParti(idx.filter(function (i) { return !d.ricerca[i]; }), 4, function (i) { return passo('ricerca', { indice: i }).then(aggiornaVista); })
      .then(ricarica).then(function (d2) {
        j.fase = 'Scrivo i capitoli…'; aggiornaVista();
        var capEDom = function (i) {
          return (d2.capitoli[i] ? Promise.resolve() : passo('capitolo', { indice: i }).then(ricarica).then(function () { j.fase = 'Scrivo i capitoli · ' + Object.keys((dispLocale(c.id) || {}).capitoli || {}).length + ' di ' + n + ' pronti'; aggiornaVista(); }))
            .then(function () { return d2.domande[i] ? null : passo('domande', { indice: i }); });
        };
        // il primo capitolo da solo (prepara la memoria condivisa degli appunti), poi gli altri insieme
        return capEDom(0).then(function () { return aParti(idx.slice(1), 3, capEDom); });
      }).then(ricarica).then(function (d3) {
        if (d3.mappa) return d3;
        j.fase = 'Disegno la mappa…'; aggiornaVista();
        return passo('mappa').then(ricarica);
      });
  }).then(function () {
    c.stato = 'pronta'; salva(); delete JOBS[c.id]; toast('Pronto: ' + c.titolo); aggiornaVista();
  }).catch(function (e) {
    c.stato = 'parziale'; salva(); j.errore = erroreAI(e); ricarica().then(aggiornaVista);
  });
}

// ---------- MAPPA: centro, rami con foglie, linee colorate, collegamenti ----------
function mappaHTML(d, c, conCapitoli) {
  var M = d.mappa, rami = M.rami.slice(0, 6), n = rami.length, sopra = n >= 4 ? 2 : (n === 3 ? 1 : 0);
  var nodo = function (r, k) {
    var key = 'r' + k, gia = d.approfondimenti[key], largo = (k >= sopra && (n - sopra) % 2 === 1 && k === n - 1) || (k < sopra && sopra === 1);
    return '<div class="node c' + ((k % 6) + 1) + (largo ? ' largo' : '') + '" data-k="' + k + '"><div class="nt"><span class="nn">' + (k + 1) + '</span><b>' + esc(r.titolo) + '</b></div>' +
      '<div class="tx">' + marca(r.testo) + '</div>' + (r.foglie && r.foglie.length ? '<ul class="fo">' + r.foglie.map(function (f) { return '<li>' + marca(f) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="nb">' + (conCapitoli && d.capitoli[r.capitolo - 1] ? '<button type="button" class="vai" data-vai="' + (r.capitolo - 1) + '">Cap. ' + r.capitolo + ' →</button>' : '') +
      '<button type="button" class="ap" data-ap="' + key + '" data-cap="' + Math.max(0, r.capitolo - 1) + '" data-txt="' + esc(r.titolo + ': ' + String(r.testo).replace(/\[\[[gcru]\|([^\]]*)\]\]/g, '$1')) + '">' + (gia ? 'Approfondito ✓' : '+ Approfondisci') + '</button></div></div>';
  };
  var h = '<div class="paper mappa"><div class="mtop"><span class="lab">Mappa · parti dal centro e segui i colori</span></div>' +
    '<div class="legend"><span><s style="background:var(--y)"></s>concetto chiave</span><span><s style="background:var(--b)"></s>definizione</span><span><s style="background:var(--r)"></s>trappola</span><span><u style="text-decoration-color:var(--u);text-decoration-thickness:2px">formula · dato</u></span></div>' +
    '<div class="map"><svg class="linee" aria-hidden="true"></svg>' + rami.slice(0, sopra).map(function (r, k) { return nodo(r, k); }).join('') +
    '<div class="core"><b>' + esc(M.centro || c.titolo) + '</b>' + (M.sottotitolo ? '<span>' + esc(M.sottotitolo) + '</span>' : '') + '</div>' +
    rami.slice(sopra).map(function (r, k) { return nodo(r, k + sopra); }).join('') + '</div>';
  if (M.collegamenti && M.collegamenti.length) h += '<div class="colleg"><span class="lab">Collegamenti tra i rami</span>' + M.collegamenti.map(function (x) {
    return '<div><span class="cp"><i class="c' + (((x.da - 1) % 6) + 1) + '">' + x.da + '</i>⟷<i class="c' + (((x.a - 1) % 6) + 1) + '">' + x.a + '</i></span><span>' + esc(x.perche) + '</span></div>'; }).join('') + '</div>';
  return h + '</div>';
}
function lineeMappa(map) {
  if (!map) return;
  var disegna = function () {
    var svg = map.querySelector('svg.linee'), core = map.querySelector('.core'); if (!svg || !core || !map.offsetWidth) return;
    var R = map.getBoundingClientRect(), C = core.getBoundingClientRect(), cx = C.left - R.left + C.width / 2, cTop = C.top - R.top, cBot = C.bottom - R.top, p = '', rr = 9;
    svg.setAttribute('viewBox', '0 0 ' + R.width + ' ' + R.height); svg.style.height = R.height + 'px';
    map.querySelectorAll('.node').forEach(function (nd) {
      var B = nd.getBoundingClientRect(), x0 = B.left - R.left, x1 = B.right - R.left, y0 = B.top - R.top, col = getComputedStyle(nd).getPropertyValue('--cb').trim(), su = B.bottom - R.top <= cTop + 1, d;
      if (nd.classList.contains('largo')) d = su ? 'M' + cx + ' ' + cTop + ' L' + cx + ' ' + (B.bottom - R.top) : 'M' + cx + ' ' + cBot + ' L' + cx + ' ' + y0;
      else {
        var sx = x1 < cx ? x1 : x0, dir = x1 < cx ? -1 : 1, y = y0 + 19, sy = su ? cTop : cBot, v = su ? 1 : -1;
        var cs = cx + dir * 3; d = 'M' + cs + ' ' + sy + ' L' + cs + ' ' + (y + v * rr) + ' Q' + cs + ' ' + y + ' ' + (cs + dir * rr) + ' ' + y + ' L' + sx + ' ' + y;
        p += '<circle cx="' + sx + '" cy="' + y + '" r="4" fill="' + col + '"/>';
      }
      p = '<path d="' + d + '" stroke="' + col + '"/>' + p;
    });
    svg.innerHTML = p + '<circle cx="' + cx + '" cy="' + cTop + '" r="3.5" fill="#0F2350"/><circle cx="' + cx + '" cy="' + cBot + '" r="3.5" fill="#0F2350"/>';
  };
  disegna(); setTimeout(disegna, 120); if (document.fonts && document.fonts.ready) document.fonts.ready.then(disegna);
  if (!lineeMappa.su) { lineeMappa.su = true; window.addEventListener('resize', function () { var m = document.querySelector('#v-dispensa .map'); if (m) lineeMappa(m); }); }
}

// Quanto del file è entrato nella dispensa: lo dice sempre, anche quando non ha finito.
function copertura(c, d, j) {
  if (!d.pagine) return '';
  var P = partiDi(c), n = d.argomenti.length, fatti = P.dispensa ? Object.keys(d.capitoli).length : Object.keys(d.domande).length, cosa = P.dispensa ? 'capitoli' : 'gruppi di domande';
  var unita = d.tipoPagine === 'parte' ? 'parti' : 'pagine', h = '';
  if (d.tagliato) h += '<div class="cop ko"><b>File troppo lungo: ho letto ' + unita + ' 1–' + d.pagine + ' su ' + d.pagineTotali + '.</b><span>Per il resto carica un secondo file: così nessuna pagina resta fuori.</span></div>';
  if (!n || (!P.dispensa && !P.test)) return h;
  var manc = d.argomenti.filter(function (a, i) { return P.dispensa ? !d.capitoli[i] : !d.domande[i]; });
  var range = function (l) { var r = []; l.forEach(function (a) { var u = r[r.length - 1]; if (u && a.da <= u[1] + 1) u[1] = Math.max(u[1], a.a); else r.push([a.da, a.a]); }); return r.map(function (x) { return x[0] + (x[1] > x[0] ? '–' + x[1] : ''); }).join(', '); };
  var pl = function (k, uno, tanti) { return k + ' ' + (k === 1 ? uno : tanti); };
  if (!manc.length) h += '<div class="cop ok"><b>✓ Copertura completa</b><span>' + (d.tipoPagine === 'parte' ? pl(d.pagine, 'parte letta', 'parti lette') : pl(d.pagine, 'pagina letta', 'pagine lette')) + ' → ' + (P.dispensa ? pl(n, 'capitolo', 'capitoli') : pl(n, 'argomento con le sue domande', 'argomenti con le loro domande')) + '. Ogni ' + (P.dispensa ? 'capitolo' : 'argomento') + ' indica da dove viene: tocca le pagine per vedere il testo originale.</span></div>';
  else if (j && !j.errore) h += '<div class="cop lav"><b>In scrittura: ' + fatti + ' di ' + n + ' ' + cosa + '</b><span>Mancano ancora le ' + unita + ' ' + range(manc) + '.</span></div>';
  else h += '<div class="cop wa"><b>Non ho finito: ' + fatti + ' di ' + n + ' ' + cosa + '</b><span>Mancano le ' + unita + ' ' + range(manc) + '. Il resto è già qui sotto.</span><button class="btn v small" data-riprendi="' + c.id + '">Completa le parti mancanti</button></div>';
  return h;
}
function mostraPagina(c, d, n) {
  var nome = d.tipoPagine === 'parte' ? 'Parte ' + n : 'Pagina ' + n;
  sheet('<span class="lab">Dai tuoi appunti · ' + esc(c.file || 'testo incollato') + '</span><h2 style="font-size:22px">' + nome + '</h2><div id="pg-t" class="orig"><span class="spin"></span></div><button class="btn ghost" data-close style="color:var(--blu2)">Chiudi</button>', function (r) {
    r.querySelector('[data-close]').onclick = chiudiSheet;
    api('/api/caricamento?uid=' + S.uid + '&cid=' + c.id + '&pagina=' + n).then(function (x) { var e = $('pg-t'); if (e) e.textContent = x.testo || '(pagina vuota)'; }).catch(function () { var e = $('pg-t'); if (e) e.textContent = 'Non riesco a caricare la pagina.'; });
  });
}

// ---------- DISPENSA ----------
function vDispensa(cid) {
  var v = $('v-dispensa'), c = S.caricamenti.find(function (x) { return x.id === cid; }); if (!c) return mostra('studia');
  var d = dispLocale(cid);
  if (!d) { v.innerHTML = '<div class="card"><span class="spin"></span></div>'; dispCarica(cid).then(function (x) { if (x && cur.view === 'dispensa') vDispensa(cid); else if (!x) v.innerHTML = '<div class="empty">Dispensa non trovata.</div>'; }); return; }
  FONTI_VIS = { fonti: d.fonti || [], tipo: d.tipoPagine || 'pagina' };
  var j = JOBS[cid], m = materia(c.materiaId), h = '<button class="back" data-b>← ' + esc(m ? m.nome : 'Studia') + '</button><h1 class="h1" style="font-size:28px">' + esc(c.titolo || d.titolo) + '</h1>';
  h += copertura(c, d, j);
  if (j && !(j.errore && d.pagine)) h += '<div class="dc lav"><div class="attesa">' + (j.errore ? '<b style="color:var(--kob)">Si è fermato: ' + esc(j.errore) + '</b>' : '<span class="spin"></span>' + esc(j.fase)) + '</div>' + fasi(j) + '<div class="bar"><i style="width:' + Math.round(j.fatti / Math.max(1, j.totali) * 100) + '%"></i></div></div>';
  if (d.mappa && d.mappa.rami && d.mappa.rami.length) h += mappaHTML(d, c, partiDi(c).dispensa);
  var pp = partiDi(c);
  if (!pp.dispensa && d.argomenti.length) {
    h += '<div class="paper"><span class="lab">Argomenti del testo</span>' + d.argomenti.map(function (a, i) { var nd = ((d.domande[i] || {}).crocette || []).length; return '<p style="margin:8px 0"><span class="n" style="display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--blu);color:#fff;font-weight:700;font-size:13px;margin-right:8px">' + (i + 1) + '</span><b>' + esc(a.titolo) + '</b>' + (a.da ? ' <button type="button" class="pp" data-pag="' + a.da + '">pp. ' + a.da + (a.a > a.da ? '–' + a.a : '') + '</button>' : '') + (nd ? ' <span class="note">· ' + nd + ' domande</span>' : '') + '<br><span class="note">' + esc(a.descrizione || '') + '</span></p>'; }).join('') + '</div>';
    if (!j) h += '<div class="row" style="gap:10px;flex-wrap:wrap">' + (!pp.test ? '<button class="btn small" data-agg="' + cid + ':test">+ Crea il test</button>' : '') + (!pp.mappa ? '<button class="btn small" data-agg="' + cid + ':mappa">+ Crea la mappa</button>' : '') + '<button class="btn ghost small" data-agg="' + cid + ':dispensa" style="color:var(--blu)">Crea la dispensa completa</button></div>';
  }
  if (pp.dispensa) d.argomenti.forEach(function (a, i) {
    var cp = d.capitoli[i];
    if (!cp) { h += '<div class="paper c' + ((i % 6) + 1) + '" style="opacity:.75"><h3><span class="n">' + (i + 1) + '</span>' + esc(a.titolo) + '</h3>' + (a.da ? '<span class="note">pp. ' + a.da + (a.a > a.da ? '–' + a.a : '') + '</span>' : '') + '<div class="attesa">' + (j && !j.errore ? '<span class="spin"></span>In scrittura…' : 'Non ancora scritto') + '</div></div>'; return; }
    h += '<div class="paper c' + ((i % 6) + 1) + '" id="cap' + i + '"><h3><span class="n">' + (i + 1) + '</span>' + esc(cp.titolo) + '</h3>' + (a.da ? '<button type="button" class="pp" data-pag="' + a.da + '">' + (d.tipoPagine === 'parte' ? 'Dalle parti ' : 'Dalle pagine ') + a.da + (a.a > a.da ? '–' + a.a : '') + ' dei tuoi appunti</button>' : '');
    cp.paragrafi.forEach(function (p, k) {
      var key = 'c' + i + 'p' + k, ap = d.approfondimenti[key];
      h += '<p id="c' + i + 'p' + k + '">' + marca(p) + ' <button type="button" class="linkap' + (ap ? ' salvato' : '') + '" data-ap="' + key + '" data-cap="' + i + '" data-txt="' + esc(p.replace(/\[\[[gcru]\|([^\]]*)\]\]/g, '$1')) + '">' + (ap ? '✓ Approfondito' : '+ Approfondisci') + '</button></p>';
      if (ap) h += boxApp(ap);
    });
    if (cp.esempio) h += '<div class="box es"><span class="t">Esempio</span>' + marca(cp.esempio) + '</div>';
    if (cp.trappola) h += '<div class="box tr"><span class="t">Trappola</span>' + marca(cp.trappola) + '</div>';
    if (cp.ricorda) h += '<div class="box rem"><span class="t">Da ricordare</span>' + marca(cp.ricorda) + '</div>';
    if (cp.confronto && cp.confronto.length) h += '<span class="lab">I tuoi appunti a confronto con le fonti</span><div class="cmp">' + cp.confronto.map(function (x) {
      var ic = x.tipo === 'ok' ? '<i class="ic i-ok">✓</i>' : x.tipo === 'incompleto' ? '<i class="ic i-w">!</i>' : '<i class="ic i-no">≠</i>';
      return '<div>' + ic + '<span>' + (x.tipo === 'incompleto' ? '<b>Incompleto:</b> ' : x.tipo === 'diverso' ? '<b>Diverso:</b> ' : '') + marca(x.testo) + '</span></div>';
    }).join('') + '</div>';
    h += '<button type="button" class="studiato' + (letto(cid, i) ? ' si' : '') + '" data-letto="' + i + '">' + (letto(cid, i) ? '✓ Studiato' : 'Segna come studiato') + '</button>';
    var mie = (d.ricerca[i] && d.ricerca[i].nums) || [];
    h += '<div class="srcs"><span class="t">Fonti</span>' + (mie.length ? mie.map(function (n) { var f = (d.fonti || []).find(function (x) { return x.n === n; }); return f ? '<span>[' + n + '] <a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.titolo) + '</a>' + (f.sito ? ' · ' + esc(f.sito) : '') + '</span>' : ''; }).join('') : '<span>Nessuna fonte affidabile trovata: il capitolo si basa sui tuoi appunti.</span>') + '</div></div>';
  });
  var nq = domandeDi(cid).length;
  if (nq) h += '<button class="btn v" data-ver>Fai il test · ' + nq + ' domande</button>';
  if (pp.dispensa && Object.keys(d.capitoli).length) h += '<button class="btn ghost" data-stampa style="color:var(--blu)">⤓ Scarica in PDF o stampa</button>';
  h += '<button class="linkap" data-del style="color:var(--kob);align-self:center">Elimina' + (pp.dispensa ? ' questa dispensa' : '') + '</button>';
  v.innerHTML = h;
  lineeMappa(v.querySelector('.map'));
  v.querySelectorAll('[data-vai]').forEach(function (b) { b.onclick = function () { var x = $('cap' + b.dataset.vai); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
  v.querySelector('[data-b]').onclick = function () { mostra('studia'); };
  v.querySelectorAll('[data-ap]').forEach(function (b) { b.onclick = function () { approfondisci(c, d, b.dataset.ap, +b.dataset.cap, b.dataset.txt); }; });
  v.querySelectorAll('[data-fonte]').forEach(function (b) { b.onclick = function () { mostraFonte(d, +b.dataset.fonte); }; });
  v.querySelectorAll('[data-letto]').forEach(function (b) { b.onclick = function () { segnaLetto(cid, +b.dataset.letto); var on = letto(cid, +b.dataset.letto); b.classList.toggle('si', on); b.textContent = on ? '✓ Studiato' : 'Segna come studiato'; if (on) toast('Segnato: ottimo lavoro'); }; });
  var stp = v.querySelector('[data-stampa]'); if (stp) stp.onclick = function () { document.title = (c.titolo || 'Dispensa') + ' · UniLampo'; window.print(); setTimeout(function () { document.title = 'UniLampo'; }, 1500); };
  v.querySelectorAll('[data-pag]').forEach(function (b) { b.onclick = function () { mostraPagina(c, d, +b.dataset.pag); }; });
  v.querySelectorAll('[data-riprendi]').forEach(function (b) { b.onclick = function () { if (!AI.accesa) return toast(PAUSA); delete JOBS[cid]; prepara(c); vDispensa(cid); }; });
  v.querySelectorAll('[data-agg]').forEach(function (b) { b.onclick = function () { aggiungiParte(b.dataset.agg); }; });
  var ver = v.querySelector('[data-ver]'); if (ver) ver.onclick = function () { avviaTest({ tipo: 'verifica', cid: cid }); };
  v.querySelector('[data-del]').onclick = function () {
    if (!confirm('Eliminare questa dispensa?')) return;
    api('/api/caricamento?uid=' + S.uid + '&cid=' + cid, null, 'DELETE').catch(function () {}); try { localStorage.removeItem('ul-d-' + cid); } catch (e) {}
    S.caricamenti = S.caricamenti.filter(function (x) { return x.id !== cid; }); salva(); mostra('studia');
  };
}


// ---------- calcoli di studio ----------
function materia(id) { return S.materie.find(function (m) { return m.id === id; }); }
function carDi(mid) { return S.caricamenti.filter(function (c) { return c.materiaId === mid; }); }
function domandeDi(cid) {
  var d = dispLocale(cid), out = []; if (!d) return out;
  Object.keys(d.domande || {}).forEach(function (i) { ((d.domande[i] || {}).crocette || []).forEach(function (q, n) { out.push({ qid: cid + ':' + i + ':' + n, q: q, cid: cid, cap: +i }); }); });
  Object.keys(d.approfondimenti || {}).forEach(function (k) { var a = d.approfondimenti[k]; (a.crocette || []).forEach(function (q, n) { out.push({ qid: cid + ':a' + k + ':' + n, q: q, cid: cid, cap: a.capitolo || 0, app: true }); }); });
  return out;
}
function domandeMateria(mid) { var o = []; carDi(mid).forEach(function (c) { o = o.concat(domandeDi(c.id)); }); return o; }
function oraliMateria(mid) {
  var o = []; carDi(mid).forEach(function (c) { var d = dispLocale(c.id); if (!d) return; Object.keys(d.domande || {}).forEach(function (i) { ((d.domande[i] || {}).orali || []).forEach(function (x) { o.push({ cid: c.id, cap: +i, domanda: x.domanda, punti: x.punti }); }); }); });
  return o;
}
function statMateria(mid) {
  var ok = 0, tot = 0, pref = carDi(mid).map(function (c) { return c.id + ':'; });
  Object.keys(S.risposte).forEach(function (q) { if (pref.some(function (p) { return q.indexOf(p) === 0; })) { var r = S.risposte[q]; ok += r.ok; tot += r.ok + r.ko; } });
  return { ok: ok, tot: tot, pct: tot ? Math.round(ok / tot * 100) : null };
}
function daRipassare(mid) {
  var oggiS = giorno(), qs = mid ? domandeMateria(mid) : [].concat.apply([], S.materie.map(function (m) { return domandeMateria(m.id); }));
  return qs.filter(function (x) { var r = S.risposte[x.qid]; return r && r.ko > 0 && r.prossima <= oggiS; });
}
function inArrivo() { var oggiS = giorno(), n = 0; Object.keys(S.risposte).forEach(function (q) { var r = S.risposte[q]; if (r.prossima > oggiS && r.box < 4) n++; }); return n; }
var INTERVALLI = [1, 2, 4, 8, 16];
function registraRisposta(qid, giusta) {
  var r = S.risposte[qid] || { ok: 0, ko: 0, box: 0 };
  if (giusta) { r.ok++; r.box = Math.min(4, r.box + 1); } else { r.ko++; r.box = 0; }
  r.ultima = giorno(); r.prossima = giusta ? traGiorni(INTERVALLI[r.box]) : giorno(); // le sbagliate entrano subito nel ripasso
  S.risposte[qid] = r; salva();
}
function argomentiDeboli() {
  var m = {};
  Object.keys(S.risposte).forEach(function (q) {
    var p = q.split(':'), cid = p[0], cap = p[1].charAt(0) === 'a' ? null : +p[1], r = S.risposte[q];
    var d = dispLocale(cid); if (!d) return;
    if (cap === null) { var ap = d.approfondimenti[p[1].slice(1)]; cap = ap ? ap.capitolo || 0 : 0; }
    var k = cid + ':' + cap; if (!m[k]) m[k] = { cid: cid, cap: cap, ok: 0, ko: 0 };
    m[k].ok += r.ok; m[k].ko += r.ko;
  });
  return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return x.ok + x.ko >= 3 && x.ko > 0; })
    .map(function (x) { x.pct = Math.round(x.ok / (x.ok + x.ko) * 100); return x; }).sort(function (a, b) { return a.pct - b.pct; });
}
function titoloCap(cid, cap) { var d = dispLocale(cid); return d && d.capitoli[cap] ? d.capitoli[cap].titolo : (d && d.argomenti[cap] ? d.argomenti[cap].titolo : 'Argomento'); }

function giornoIt(d) { return d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''; }

var pdfjs = null;
function leggiFile(f) {
  if (!/pdf$/i.test(f.name) && f.type !== 'application/pdf') return f.text().then(function (t) { return { testo: t }; });
  var carica = pdfjs ? Promise.resolve(pdfjs) : import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(function (m) { m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'; pdfjs = m; return m; });
  return Promise.all([carica, f.arrayBuffer()]).then(function (x) {
    return x[0].getDocument({ data: x[1] }).promise.then(function (doc) {
      var pagine = [], p = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) (function (n) { p = p.then(function () { return doc.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) { pagine.push(tc.items.map(function (it) { return it.str + (it.hasEOL ? '\n' : ' '); }).join('')); }); }); })(i);
      return p.then(function () { return { testo: pagine.map(function (t, k) { return '[[PAGINA ' + (k + 1) + ']]\n' + t; }).join('\n\n').replace(/[ \t]+/g, ' '), pagine: doc.numPages }; });
    });
  });
}
function notaAI() { return AI.accesa ? '' : '<div class="box tr"><span class="t">In pausa</span>' + PAUSA + '</div>'; }

function boxApp(ap) {
  return '<div class="box app"><span class="t">Approfondimento · ' + esc(ap.titolo) + '</span>' + ap.paragrafi.map(function (p) { return '<p style="margin:0 0 6px">' + marca(p) + '</p>'; }).join('') +
    ap.esempi.map(function (e) { return '<div class="box es" style="margin-top:6px"><span class="t">Esempio in più</span>' + marca(e) + '</div>'; }).join('') +
    (ap.collegamenti.length ? '<div style="margin-top:6px"><span class="t" style="color:var(--muto)">Collegamenti</span><div class="chips">' + ap.collegamenti.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div></div>' : '') + '</div>';
}
function mostraFonte(d, n) {
  var f = (d.fonti || []).find(function (x) { return x.n === n; }); if (!f) return;
  sheet('<span class="lab">Fonte [' + n + ']</span><h2 style="font-size:20px">' + esc(f.titolo) + '</h2>' + (f.sito ? '<span class="note">' + esc(f.sito) + (f.tipo ? ' · ' + esc(f.tipo) : '') + '</span>' : '') +
    (f.punti && f.punti.length ? '<div class="srcs"><span class="t">Cosa dice di utile</span>' + f.punti.map(function (p) { return '<span>• ' + esc(p) + '</span>'; }).join('') + '</div>' : '') +
    '<span class="note">Trovata con la ricerca web' + (function () { var caps = d.argomenti.map(function (x, i) { return d.ricerca[i] && (d.ricerca[i].nums || []).indexOf(n) >= 0 ? 'cap. ' + (i + 1) : null; }).filter(Boolean); return caps.length ? ' · citata in ' + caps.join(', ') : ''; })() + '. Indirizzo controllato: è uno di quelli restituiti davvero dalla ricerca.</span>' +
    '<a class="btn" href="' + esc(f.url) + '" target="_blank" rel="noopener" style="text-decoration:none">Apri la fonte</a><button class="btn ghost" data-close style="color:var(--blu2)">Chiudi</button>', function (r) { r.querySelector('[data-close]').onclick = chiudiSheet; });
}
function approfondisci(c, d, key, cap, testo) {
  var gia = d.approfondimenti[key];
  if (gia) return sheet('<div class="flex"><span class="lab">Approfondimento</span><span class="tag dark">Nella dispensa ✓</span></div>' + corpoApp(d, gia) + '<span class="note">Salvato nella dispensa il ' + giornoIt(gia.data) + '.</span><button class="btn v" data-close>Chiudi</button>', function (r) { legaSheet(r, d); });
  sheet('<span class="lab">Approfondisci</span><div style="font-family:\'Bricolage Grotesque\';font-size:17px;line-height:1.3">“' + esc(testo.slice(0, 110)) + (testo.length > 110 ? '…' : '') + '”</div>' +
    '<span class="note">Spiegazione più profonda, esempi, collegamenti con gli altri argomenti di ' + esc((materia(c.materiaId) || {}).nome || 'questa materia') + ', fonti e 3 domande nuove per i test. Si genera una volta e si salva nella dispensa.</span>' +
    notaAI() +
    '<button class="btn" id="ap-go"' + (AI.accesa ? '' : ' disabled') + '>Genera approfondimento</button><button class="btn ghost" data-close style="color:var(--blu2)">Annulla</button>', function (r) {
      r.querySelector('[data-close]').onclick = chiudiSheet;
      var b = r.querySelector('#ap-go'); if (!b) return;
      b.onclick = function () {
        b.disabled = true; b.innerHTML = '<span class="spin"></span> Sto approfondendo…';
        var altri = []; carDi(c.materiaId).forEach(function (x) { var dd = dispLocale(x.id); if (dd) dd.argomenti.forEach(function (a) { altri.push(a.titolo); }); });
        genera(c.id, 'approfondisci', { chiave: key, capitolo: cap, parte: testo, altri: altri.slice(0, 40) }).then(function (res) {
          d.approfondimenti[key] = res.dato; if (res.fonti) d.fonti = res.fonti; dispSalva(c.id, d);
          var y = window.scrollY; vDispensa(c.id); window.scrollTo(0, y);
          approfondisci(c, d, key, cap, testo); toast('Salvato nella dispensa');
        }).catch(function (e) { b.disabled = false; b.textContent = 'Genera approfondimento'; toast(erroreAI(e)); });
      };
    });
}
function corpoApp(d, ap) {
  return '<h2 style="font-size:21px">' + esc(ap.titolo) + '</h2>' + ap.paragrafi.map(function (p) { return '<p style="margin:0;font-size:15px;line-height:1.55">' + marca(p) + '</p>'; }).join('') +
    ap.esempi.map(function (e) { return '<div class="box es"><span class="t">Esempio in più</span>' + marca(e) + '</div>'; }).join('') +
    (ap.collegamenti.length ? '<span class="lab">Collegamenti nella materia</span><div class="chips">' + ap.collegamenti.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
    fontiCitate(d, [ap.paragrafi.join(' '), ap.esempi.join(' ')].join(' '));
}
function fontiCitate(d, testo) {
  var nums = []; String(testo).replace(/\[(\d{1,2})\]/g, function (m, x) { x = +x; if (nums.indexOf(x) < 0) nums.push(x); });
  var fs = nums.map(function (n) { return (d.fonti || []).find(function (f) { return f.n === n; }); }).filter(Boolean);
  return fs.length ? '<div class="srcs"><span class="t">Fonti</span>' + fs.map(function (f) { return '<span>[' + f.n + '] <a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.titolo) + '</a></span>'; }).join('') + '</div>' : '<div class="srcs"><span class="t">Fonti</span><span>Basato sui tuoi appunti e sulla dispensa: nessuna fonte esterna citata.</span></div>';
}
function legaSheet(r, d) { r.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = chiudiSheet; }); r.querySelectorAll('[data-fonte]').forEach(function (b) { b.onclick = function () { mostraFonte(d, +b.dataset.fonte); }; }); }


// ---------- TEST ----------
var T = null;
function mescola(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function avviaTest(o) {
  var pool;
  if (o.tipo === 'verifica') pool = domandeDi(o.cid);
  else if (o.tipo === 'ripasso') pool = daRipassare(o.mid);
  else if (o.tipo === 'simulazione') pool = mescola(domandeMateria(o.mid)).slice(0, 30);
  else pool = mescola(domandeMateria(o.mid)).sort(function (a, b) { var ra = S.risposte[a.qid], rb = S.risposte[b.qid]; return (ra ? ra.box : -1) - (rb ? rb.box : -1); }).slice(0, 15);
  var visti = {}; pool = pool.filter(function (x) { var k = String(x.q.testo).toLowerCase().replace(/\s+/g, ' ').trim(); if (visti[k]) return false; visti[k] = 1; return true; });
  if (!pool.length) { toast('Nessuna domanda da fare qui.'); return; }
  T = { o: o, lista: mescola(pool).map(function (x) { var ord = mescola([0, 1, 2, 3]); return { qid: x.qid, cid: x.cid, q: x.q, ord: ord }; }), i: 0, ok: 0, risposto: false, inizio: Date.now(), sim: o.tipo === 'simulazione', risposte: [] };
  if (T.sim) T.fine = Date.now() + Math.round(T.lista.length * 1.5) * 60000;
  mostra('test', { inCorso: true });
}
function disegnaDomanda() {
  var v = $('v-test'), x = T.lista[T.i];
  if (!x) return fineTest();
  if (T.sim) return domandaSim();
  var q = x.q, c = S.caricamenti.find(function (k) { return k.id === x.cid; }) || {};
  var h = '<div class="flex"><button class="back" data-esci>← Esci</button><span class="tag">' + esc((materia(c.materiaId) || {}).nome || '') + '</span></div><div class="card">' +
    '<div class="qtop"><span>Domanda ' + (T.i + 1) + ' di ' + T.lista.length + '</span><span class="pill">' + T.ok + ' giuste</span></div><div class="bar"><i style="width:' + Math.round(T.i / T.lista.length * 100) + '%"></i></div>' +
    '<p class="qtxt">' + esc(q.testo) + '</p><div class="opts">' + x.ord.map(function (k, pos) { return '<button class="opt" data-k="' + k + '">' + esc(q.opzioni[k]) + '</button>'; }).join('') + '</div><div id="t-exp"></div></div>';
  v.innerHTML = h;
  v.querySelector('[data-esci]').onclick = function () { T = null; mostra('test'); };
  v.querySelectorAll('.opt').forEach(function (b) {
    b.onclick = function () {
      if (T.risposto) return; T.risposto = true;
      var k = +b.dataset.k, giusta = k === q.giusta;
      v.querySelectorAll('.opt').forEach(function (o) { o.disabled = true; if (+o.dataset.k === q.giusta) o.classList.add('ok'); });
      if (!giusta) b.classList.add('ko'); else T.ok++;
      registraRisposta(x.qid, giusta);
      var d = dispLocale(x.cid), fonte = /^\[\d+\]$/.test(q.fonte) && d ? (d.fonti || []).find(function (f) { return '[' + f.n + ']' === q.fonte; }) : null;
      $('t-exp').innerHTML = '<div class="exp"><b>' + (giusta ? 'Giusto' : 'Perché “' + esc(q.opzioni[q.giusta]) + '”') + '</b><span>' + esc(q.spiegazione) + '</span><span class="src">Da: ' + esc(titoloCap(x.cid, +x.qid.split(':')[1] || 0)) + (fonte ? ' · fonte [' + fonte.n + '] ' + esc(fonte.titolo) : ' · appunti') + '</span></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn v small" id="t-next">' + (T.i + 1 < T.lista.length ? 'Avanti →' : 'Vedi il risultato') + '</button></div>';
      $('t-next').onclick = function () { T.i++; T.risposto = false; disegnaDomanda(); window.scrollTo(0, 0); };
    };
  });
}
// Simulazione: a tempo, senza spiegazioni durante; alla fine voto in trentesimi e correzione.
function domandaSim() {
  var v = $('v-test'), x = T.lista[T.i], q = x.q;
  v.innerHTML = '<div class="flex"><button class="back" data-esci>← Esci</button><span class="timer" id="t-tempo"></span></div><div class="card"><div class="qtop"><span>Simulazione · domanda ' + (T.i + 1) + ' di ' + T.lista.length + '</span><span class="pill">senza aiuti</span></div><div class="bar"><i style="width:' + Math.round(T.i / T.lista.length * 100) + '%"></i></div>' +
    '<p class="qtxt">' + esc(q.testo) + '</p><div class="opts">' + x.ord.map(function (k) { return '<button class="opt" data-k="' + k + '">' + esc(q.opzioni[k]) + '</button>'; }).join('') + '</div><button class="linkap" data-salta style="align-self:center">Salta (vale come non data)</button></div>';
  var tick = function () { var e = $('t-tempo'); if (!e || !T || !T.sim) return clearInterval(T && T.tk); var r = Math.max(0, T.fine - Date.now()); e.textContent = '⏱ ' + Math.floor(r / 60000) + ':' + String(Math.floor(r / 1000) % 60).padStart(2, '0'); e.classList.toggle('poco', r < 120000); if (!r) { clearInterval(T.tk); T.i = T.lista.length; fineTest(); } };
  clearInterval(T.tk); T.tk = setInterval(tick, 1000); tick();
  v.querySelector('[data-esci]').onclick = function () { if (!confirm('Uscire dalla simulazione? Il voto non verrà calcolato.')) return; clearInterval(T.tk); T = null; mostra('test'); };
  var avanti = function (k) { var giusta = k === q.giusta; if (giusta) T.ok++; T.risposte.push({ x: x, k: k }); if (k !== null) registraRisposta(x.qid, giusta); T.i++; window.scrollTo(0, 0); disegnaDomanda(); };
  v.querySelectorAll('.opt').forEach(function (b) { b.onclick = function () { avanti(+b.dataset.k); }; });
  v.querySelector('[data-salta]').onclick = function () { avanti(null); };
}
function fineSim() {
  clearInterval(T.tk);
  var v = $('v-test'), n = T.lista.length, voto = Math.round(T.ok / n * 30), min = Math.max(1, Math.round((Date.now() - T.inizio) / 60000)), sbagliate = T.risposte.filter(function (r) { return r.k !== r.x.q.giusta; });
  var nonDate = n - T.risposte.length;
  S.simulazioni = (S.simulazioni || []).concat([{ mid: T.o.mid, data: giorno(), voto: voto, ok: T.ok, n: n }]).slice(-30); salva();
  var h = '<div class="card" style="align-items:flex-start"><span class="lab">Simulazione d\'esame · risultato</span><div class="score">' + voto + '<span style="font-size:22px">/30</span></div><span>' + T.ok + ' giuste su ' + n + (nonDate ? ' (' + nonDate + ' non date)' : '') + ' in ' + min + (min === 1 ? ' minuto. ' : ' minuti. ') + (voto >= 18 ? 'Sufficiente.' : 'Sotto il 18: ripassa le sbagliate e riprova.') + '</span><span class="note">Calcolo: 1 punto per risposta giusta, nessuna penalità, riportato in trentesimi. Il tuo esame può avere regole diverse.</span>' +
    '<div class="row" style="width:100%"><button class="btn v" id="t-ancora">Nuova simulazione</button><button class="btn ghost" id="t-rip" style="color:var(--blu)">Torna ai test</button></div></div>';
  if (sbagliate.length) h += '<div class="sez">Correzione · ' + sbagliate.length + (sbagliate.length === 1 ? ' errore' : ' errori') + '</div>' + sbagliate.map(function (r) { var q = r.x.q; return '<div class="card" style="gap:6px"><b style="font-size:15px">' + esc(q.testo) + '</b>' + (r.k === null ? '<span class="note">Non data</span>' : '<span style="color:var(--kob);text-decoration:line-through">' + esc(q.opzioni[r.k]) + '</span>') + '<span style="color:var(--okt);font-weight:700">✓ ' + esc(q.opzioni[q.giusta]) + '</span><span class="note">' + esc(q.spiegazione) + '</span></div>'; }).join('');
  v.innerHTML = h;
  var o = T.o; $('t-ancora').onclick = function () { avviaTest(o); };
  $('t-rip').onclick = function () { T = null; mostra('test'); };
}
function fineTest() {
  if (T.sim) return fineSim();
  var v = $('v-test'), n = T.lista.length, pct = Math.round(T.ok / n * 100);
  v.innerHTML = '<div class="card" style="align-items:flex-start"><span class="lab">Risultato</span><div class="score">' + T.ok + '<span style="font-size:22px">/' + n + '</span></div><span>' + pct + '% di risposte giuste. ' + (n - T.ok ? (n - T.ok === 1 ? 'La sbagliata è già nel ripasso.' : 'Le ' + (n - T.ok) + ' sbagliate sono già nel ripasso.') : 'Nessun errore: queste domande torneranno tra qualche giorno per fissarle.') + '</span>' +
    '<div class="row" style="width:100%"><button class="btn v" id="t-ancora">Rifai un test</button><button class="btn ghost" id="t-rip" style="color:var(--blu)">Torna ai test</button></div></div>';
  $('t-ancora').onclick = function () { var o = T.o; avviaTest(o.tipo === 'ripasso' ? { tipo: 'materia', mid: S.materie[0] && S.materie[0].id } : o); };
  $('t-rip').onclick = function () { T = null; mostra('test'); };
}


// ---------- ORALE ----------
var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null, O = null;
function vocePiuBella() {
  var vs = ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter(function (x) { return /^it/i.test(x.lang); });
  var rank = function (v) { var n = v.name; return /enhanced|premium|natural|neural/i.test(n) ? 0 : /alice|federica|paola|emma|luca/i.test(n) ? 1 : /google/i.test(n) ? 2 : 3; };
  return vs.sort(function (a, b) { return rank(a) - rank(b); })[0] || null;
}
if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; }
// Voce della commissione (sintesi vocale del telefono, gratis). Su iPhone: niente cancel() prima di parlare,
// frasi corte una alla volta (le lunghe a volte si interrompono) e prima frase dentro il tocco dell'utente.
var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var usaSR = !!SR && !IOS; // su iPhone la dettatura della tastiera è più affidabile e scrive mentre parli
// Voce vera dal server (OpenAI) quando c'è la chiave: su iPhone è l'unica affidabile. Un solo lettore audio,
// sbloccato al tocco che avvia l'orale (su iPhone l'audio parte solo così).
var player = new Audio(); player.setAttribute('playsinline', ''); player.preload = 'auto';
function sbloccaAudio() { try { player.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'; player.play().catch(function () {}); } catch (e) {} }
var voceServer = true;
function parlaVoce(t) {
  if (!AI.voce || !voceServer) return parla(t);
  return fetch('/api/voce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testo: t, uid: S.uid }) })
    .then(function (r) { if (!r.ok) throw r.status; return r.blob(); })
    .then(function (b) { return new Promise(function (res) { var fine = false, ok = function () { if (!fine) { fine = true; res(); } }; player.onended = ok; player.onerror = ok; player.src = URL.createObjectURL(b); player.play().catch(ok); setTimeout(ok, 90000); }); })
    .catch(function () { voceServer = false; return parla(t); });
}
function parla(t) {
  return new Promise(function (res) {
    if (!('speechSynthesis' in window)) return res();
    var parti = String(t).match(/[^.!?;:]+[.!?;:]*/g) || [String(t)], i = 0, chiuso = false, tm;
    var fine = function () { if (!chiuso) { chiuso = true; clearTimeout(tm); res(); } };
    tm = setTimeout(fine, Math.min(45000, 3000 + String(t).length * 95));
    var avanti = function () {
      if (i >= parti.length) return fine();
      var u = new SpeechSynthesisUtterance(parti[i++].trim()); u.lang = 'it-IT'; u.rate = 1; u.volume = 1;
      var vv = vocePiuBella(); if (vv) u.voice = vv;
      u.onend = avanti; u.onerror = avanti;
      try { speechSynthesis.speak(u); if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) { fine(); }
    };
    try { if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); } catch (e) {}
    avanti();
  });
}
function waveOn(on) { var w = document.querySelector('#o-box .wave'); if (!w) return; clearInterval(waveOn.t); if (on) waveOn.t = setInterval(function () { w.querySelectorAll('i').forEach(function (i) { i.style.height = (6 + Math.random() * 28) + 'px'; }); }, 140); else w.querySelectorAll('i').forEach(function (i) { i.style.height = '6px'; }); }
function chiParla(k) { [0, 1, 2].forEach(function (i) { var m = $('m' + i); if (m) m.classList.toggle('talk', i === k); }); }
function iniziaOrale(mid, q) {
  sbloccaAudio();
  var AC = window.AudioContext || window.webkitAudioContext;
  O = { mid: mid, q: q, storia: [], on: true, rec: null, ultima: q.domanda, libero: !!(AI.voce && window.MediaRecorder && navigator.mediaDevices && AC), ctx: AC ? new AC() : null };
  if (O.ctx && O.ctx.resume) O.ctx.resume();
  var box = $('o-box');
  box.innerHTML = '<span class="lab">Domanda</span><div class="big" style="font-size:19px">“' + esc(q.domanda) + '”</div>' +
    '<div class="flex"><div class="wave" style="flex:1">' + '<i></i>'.repeat(9) + '</div><button class="btn ghost small" id="o-ria" style="color:var(--blu)">🔊 Riascolta</button></div>' +
    '<span class="note" id="o-vol">Non senti la voce? Togli il silenzioso e alza il volume.</span>' +
    '<div class="chat" id="o-chat"></div><div id="o-stato" class="note" style="text-align:center;font-size:14px"></div>' +
    '<button class="mic hide" id="o-mic" aria-label="Rispondi a voce"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button>' +
    '<div id="o-scrivi" class="hide"><label for="o-txt" id="o-lab" style="font-weight:700;font-size:14.5px;display:block;margin-bottom:6px"></label><textarea class="in" id="o-txt" rows="5"></textarea><button class="btn" id="o-invia" style="margin-top:8px;width:100%">Invia risposta</button></div>' +
    '<button class="btn hide" id="o-fatto" style="width:100%">Ho finito di parlare</button><button class="linkap hide" id="o-scrivo" style="align-self:center">preferisco scrivere</button>' +
    '<button class="btn ghost small" id="o-stop" style="color:var(--kob)">Interrompi</button>';
  $('o-stop').onclick = function () { fermaOrale(); vOrale(); };
  $('o-ria').onclick = function () { if (!O) return; waveOn(true); parlaVoce(O.ultima).then(function () { waveOn(false); }); };
  $('o-fatto').onclick = function () { if (O && O.reg && O.reg.state === 'recording') O.reg.stop(); };
  $('o-scrivo').onclick = function () { if (!O) return; O.libero = false; if (O.reg && O.reg.state === 'recording') { O.annulla = true; O.reg.stop(); } pronto(); };
  $('o-invia').onclick = function () { if (O && O.ascolto) { O.fermato = true; try { O.rec.stop(); } catch (e) {} return; } var t = $('o-txt').value.trim(); if (!t) return; $('o-txt').value = ''; rispostaOrale(t); };
  $('o-mic').onclick = function () { if (O && O.ascolto) { O.fermato = true; try { O.rec.stop(); } catch (e) {} } else ascolta(); };
  commissione(q.domanda, 0).then(pronto); // parte dentro il tocco: su iPhone la voce si sblocca così
}
function statoO(t) { var e = $('o-stato'); if (e) e.textContent = t; }
function bolla(chi, t) { var c = $('o-chat'); if (!c) return; var b = document.createElement('div'); b.className = 'bub ' + (chi === 'studente' ? 's' : 'c'); b.textContent = t; c.appendChild(b); }
function commissione(t, chi) { if (!O || !O.on) return Promise.resolve(); if (O.storia.length) bolla('commissione', t); O.storia.push({ chi: 'commissione', testo: t }); O.ultima = t; chiParla(chi || 0); statoO('Parla la commissione…'); waveOn(true); return parlaVoce(t).then(function () { waveOn(false); chiParla(-1); }); }
function pronto() {
  if (!O || !O.on) return;
  if (O.libero) return ascoltaLibero(); // colloquio a voce, a ruota libera
  $('o-fatto').classList.add('hide'); $('o-scrivo').classList.add('hide');
  $('o-scrivi').classList.remove('hide');
  if (usaSR) {
    $('o-mic').classList.remove('hide'); $('o-lab').textContent = 'Quello che dici compare qui mentre parli';
    $('o-txt').placeholder = 'Tocca il microfono e parla…';
    statoO('Tocca il microfono e rispondi. Toccalo di nuovo quando hai finito.');
  } else {
    $('o-lab').textContent = 'Tocca qui sotto, poi il 🎤 della tastiera, e parla: il testo compare mentre parli.';
    $('o-txt').placeholder = 'La tua risposta…';
    statoO('');
  }
}
// Colloquio libero: registra finché parli; quando taci per 3 secondi (o tocchi "Ho finito") trascrive,
// la commissione risponde a voce e poi ti riascolta da sola. Il microfono si spegne mentre parla la commissione.
function ascoltaLibero() {
  if (!O || !O.on) return;
  $('o-scrivi').classList.add('hide'); $('o-mic').classList.add('hide');
  $('o-fatto').classList.remove('hide'); $('o-scrivo').classList.remove('hide');
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
    if (!O || !O.on) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    var mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac'].filter(function (m) { return window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0] || '';
    var reg = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream), parti = [], inizio = Date.now(), parlato = false, ultimaVoce = Date.now();
    O.reg = reg; O.annulla = false;
    var an = null, src = null, data = null, tick = null;
    if (O.ctx) { try { O.ctx.resume && O.ctx.resume(); an = O.ctx.createAnalyser(); an.fftSize = 1024; src = O.ctx.createMediaStreamSource(stream); src.connect(an); data = new Uint8Array(an.fftSize); } catch (e) { an = null; } }
    tick = setInterval(function () {
      var now = Date.now();
      if (an) { an.getByteTimeDomainData(data); var sum = 0; for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; } var rms = Math.sqrt(sum / data.length); if (rms > 0.03) { parlato = true; ultimaVoce = now; } }
      else parlato = true;
      var w = document.querySelectorAll('#o-box .wave i'); w.forEach(function (x) { x.style.height = (6 + (now - ultimaVoce < 300 ? Math.random() * 28 : 0)) + 'px'; });
      if ((an && parlato && now - ultimaVoce > 3000) || (!parlato && now - inizio > 15000) || now - inizio > 180000) { if (reg.state === 'recording') reg.stop(); }
    }, 120);
    reg.ondataavailable = function (e) { if (e.data && e.data.size) parti.push(e.data); };
    reg.onstop = function () {
      clearInterval(tick); try { if (src) src.disconnect(); } catch (e) {} stream.getTracks().forEach(function (t) { t.stop(); });
      $('o-fatto').classList.add('hide');
      if (!O || !O.on || O.annulla) return;
      var sec = Math.round((Date.now() - inizio) / 1000);
      if (!parlato) { statoO('Non ti ho sentita. Riprovo ad ascoltarti…'); return setTimeout(ascoltaLibero, 800); }
      statoO('Sto capendo cosa hai detto…');
      var blob = new Blob(parti, { type: reg.mimeType || mime || 'audio/mp4' });
      fetch('/api/trascrivi?uid=' + S.uid + '&sec=' + sec, { method: 'POST', headers: { 'content-type': blob.type }, body: blob })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); })
        .then(function (j) { if (j.text) rispostaOrale(j.text); else { statoO('Non ho capito bene. Ripeti pure…'); setTimeout(ascoltaLibero, 800); } })
        .catch(function (e) { statoO(e && (e.error === 'tetto' || e.error === 'spenta') ? PAUSA : 'Non riesco a trascrivere: rispondi scrivendo.'); O.libero = false; pronto(); });
    };
    reg.start(1000);
    statoO('Ti ascolto: parla liberamente. Quando ti fermi qualche secondo, la commissione risponde.');
  }).catch(function () { statoO('Il microfono è bloccato: consenti l\'accesso nelle impostazioni, oppure rispondi scrivendo.'); O.libero = false; pronto(); });
}
function ascolta() {
  var finale = '', mic = $('o-mic');
  O.ascolto = true; O.fermato = false; mic.classList.add('rec'); waveOn(true);
  statoO('Ti ascolto… tocca di nuovo il microfono quando hai finito.');
  var giro = function () {
    var r = new SR(); O.rec = r;
    r.lang = 'it-IT'; r.continuous = true; r.interimResults = true;
    r.onresult = function (e) { var temp = ''; for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finale += ' ' + e.results[i][0].transcript; else temp += e.results[i][0].transcript; } $('o-txt').value = (finale + ' ' + temp).replace(/\s+/g, ' ').trim(); };
    r.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { O.fermato = true; statoO('Il microfono è bloccato: consenti l\'accesso, oppure scrivi la risposta.'); } };
    r.onend = function () {
      if (O && O.on && !O.fermato) { try { giro(); } catch (x) {} return; } // pausa: riparte da solo
      if (!O) return;
      O.ascolto = false; mic.classList.remove('rec'); waveOn(false);
      var t = $('o-txt').value.trim();
      if (t) { $('o-txt').value = ''; rispostaOrale(t); } else statoO('Non ho sentito nulla: riprova o scrivi la risposta.');
    };
    try { r.start(); } catch (e) { O.ascolto = false; mic.classList.remove('rec'); waveOn(false); statoO('Il riconoscimento vocale non parte: scrivi la risposta.'); }
  };
  giro();
}
function rispostaOrale(t) {
  if (!O || !O.on) return;
  bolla('studente', t); O.storia.push({ chi: 'studente', testo: t });
  $('o-mic').classList.add('hide'); $('o-scrivi').classList.add('hide'); $('o-fatto').classList.add('hide'); $('o-scrivo').classList.add('hide'); statoO('La commissione sta valutando…');
  genera(O.q.cid, 'orale', { domanda: O.q.domanda, punti: O.q.punti, storia: O.storia }).then(function (r) {
    var x = r.dato, chi = O.storia.filter(function (m) { return m.chi === 'studente'; }).length % 3;
    return commissione(x.battuta || 'Grazie.', x.fine ? 0 : chi).then(function () { if (x.fine) esitoOrale(x); else pronto(); });
  }).catch(function (e) { statoO(erroreAI(e)); $('o-scrivi').classList.remove('hide'); });
}
function esitoOrale(x) {
  var q = O.q; O.on = false;
  S.orali.push({ mid: O.mid, cid: q.cid, domanda: q.domanda, voto: x.voto, lode: x.lode, data: new Date().toISOString() }); salva();
  var box = $('o-box'), sup = x.voto >= 18;
  box.insertAdjacentHTML('beforeend', '<div class="card" style="background:var(--bg);padding:14px"><div class="flex"><div><span class="lab">Voto della commissione</span><div class="score">' + (sup ? x.voto + (x.lode ? '<span style="font-size:22px"> e lode</span>' : '<span style="font-size:22px">/30</span>') : '<span style="font-size:30px">Non superato</span>') + '</div></div><span class="tag dark">Deciso dal sistema</span></div>' +
    q.punti.map(function (p, i) { var ok = x.punti[i] === true; return '<div class="pt"><i class="ic ' + (ok ? 'i-ok">✓' : 'i-no">✗') + '</i><span>' + esc(p) + '</span></div>'; }).join('') +
    (x.bene.length ? '<div><b style="font-size:13px">Bene</b><br><span style="font-size:13.5px">' + x.bene.map(esc).join(' · ') + '</span></div>' : '') +
    (x.manca.length ? '<div><b style="font-size:13px">Manca</b><br><span style="font-size:13.5px">' + x.manca.map(esc).join(' · ') + '</span></div>' : '') +
    (x.consiglio ? '<div class="note" style="font-size:13.5px">' + esc(x.consiglio) + '</div>' : '') + '<button class="btn" id="o-again">Un\'altra domanda</button></div>');
  var st = $('o-stop'); if (st) st.remove(); statoO('');
  $('o-again').onclick = function () { vOrale(); };
}
function fermaOrale() { if (!O) return; O.on = false; O.annulla = true; try { if (O.reg && O.reg.state === 'recording') O.reg.stop(); } catch (e) {} try { player.pause(); } catch (e) {} try { if (O.ctx) O.ctx.close(); } catch (e) {} try { if (O.rec) O.rec.abort(); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} waveOn(false); O = null; }


function vTest(arg) {
  var v = $('v-test');
  if (T && arg && arg.inCorso) return disegnaDomanda();
  T = null;
  var m = materiaCorrente(), h = '<h1 class="h1">Test</h1>', dueTutte = daRipassare();
  if (dueTutte.length) h += '<button class="giallo" data-rip><span>Rifai le ' + dueTutte.length + (dueTutte.length === 1 ? ' domanda sbagliata' : ' domande sbagliate') + '</span><span class="fr">→</span></button>';
  if (!m) { v.innerHTML = h + '<div class="empty"><b>Nessuna materia</b><span>Aggiungi una materia e carica gli appunti dalla sezione Studia.</span></div>'; return; }
  h += barraMaterie(false);
  var nq = domandeMateria(m.id).length, st = statMateria(m.id), deb = argomentiDeboli().filter(function (x) { var c = S.caricamenti.find(function (k) { return k.id === x.cid; }); return c && c.materiaId === m.id && x.pct < 85; });
  if (!nq) h += '<div class="empty"><b>Ancora nessuna domanda per ' + esc(m.nome) + '</b><span>Le domande nascono con ogni dispensa: circa 8 per argomento, più 3 per ogni approfondimento.</span></div>';
  else {
    var sims = (S.simulazioni || []).filter(function (x) { return x.mid === m.id; });
    h += '<div class="hero"><span class="lab">' + esc(m.nome) + '</span><h2>' + (st.pct === null ? 'Mettiti alla prova' : st.pct + '% giuste') + '</h2><span style="color:#D6E6F5;font-size:14px">' + nq + ' domande dalle tue dispense e dagli approfondimenti. Dopo ogni risposta trovi la spiegazione.</span><button class="btn" data-go>Test veloce · ' + Math.min(15, nq) + ' domande</button></div>';
    if (nq >= 10) h += '<button class="giallo" data-sim><span>⏱️ Simulazione d\'esame · ' + Math.min(30, nq) + ' domande in ' + Math.round(Math.min(30, nq) * 1.5) + ' minuti, voto in trentesimi' + (sims.length ? '<br><small style="font-weight:600">Ultimi voti: ' + sims.slice(-4).map(function (x) { return x.voto; }).join(' · ') + '</small>' : '') + '</span><span class="fr">→</span></button>';
    if (deb.length) h += '<div class="sez">Da rinforzare</div><div class="card" style="gap:8px">' + deb.slice(0, 4).map(function (x) { return '<button class="li" data-cap="' + x.cid + ':' + x.cap + '"><span><b>' + esc(titoloCap(x.cid, x.cap)) + '</b><br><span class="note">' + x.ko + ' errori su ' + (x.ok + x.ko) + ' · tocca per rileggere</span></span><span class="tag ' + (x.pct < 60 ? 'red' : 'grey') + '">' + x.pct + '%</span></button>'; }).join('') + '</div>';
    var car = carDi(m.id).filter(function (c) { return domandeDi(c.id).length; });
    if (car.length > 1) h += '<div class="sez">Per dispensa</div><div class="card" style="gap:8px">' + car.map(function (c) { return '<button class="li" data-v="' + c.id + '"><span><b>' + esc(c.titolo) + '</b></span><span class="note">' + domandeDi(c.id).length + ' →</span></button>'; }).join('') + '</div>';
  }
  v.innerHTML = h;
  legaMaterie(v);
  var r = v.querySelector('[data-rip]'); if (r) r.onclick = function () { avviaTest({ tipo: 'ripasso' }); };
  var g = v.querySelector('[data-go]'); if (g) g.onclick = function () { avviaTest({ tipo: 'materia', mid: m.id }); };
  var sm = v.querySelector('[data-sim]'); if (sm) sm.onclick = function () { avviaTest({ tipo: 'simulazione', mid: m.id }); };
  v.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { avviaTest({ tipo: 'verifica', cid: b.dataset.v }); }; });
  v.querySelectorAll('[data-cap]').forEach(function (b) { b.onclick = function () { var p = b.dataset.cap.split(':'); mostra('dispensa', p[0]); setTimeout(function () { var e = $('cap' + p[1]); if (e) e.scrollIntoView({ block: 'start' }); }, 60); }; });
}
function vOrale() {
  var v = $('v-orale'), m = materiaCorrente(), h = '<h1 class="h1">Orale</h1>';
  if (!m) { v.innerHTML = h + '<div class="empty"><b>Nessuna materia</b><span>Aggiungi una materia e carica gli appunti dalla sezione Studia.</span></div>'; return; }
  var dom = oraliMateria(m.id), ult = S.orali.filter(function (o) { return o.mid === m.id; }).slice(-3).reverse();
  if (S.oraleCid) { var solo = dom.filter(function (x) { return x.cid === S.oraleCid; }); if (solo.length) dom = solo; }
  h += barraMaterie(false) + '<div class="comm"><div class="mem" id="m0"><div class="av">P</div>Presidente</div><div class="mem" id="m1"><div class="av">C1</div>Commissario</div><div class="mem" id="m2"><div class="av">C2</div>Assistente</div></div>';
  if (!dom.length) h += '<div class="empty"><b>Ancora nessuna domanda d\'orale per ' + esc(m.nome) + '</b><span>Ogni dispensa prepara 2 domande d\'orale per argomento, con i punti che la commissione controlla.</span></div>';
  else {
    var c = S.oraleCid && S.caricamenti.find(function (k) { return k.id === S.oraleCid; });
    h += '<div class="card" id="o-box" style="align-items:center;text-align:center;gap:12px;padding:24px 16px"><button class="mic" id="o-go" aria-label="Inizia l\'orale"' + (AI.accesa ? '' : ' disabled') + '><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button>' +
      '<b style="font-family:\'Bricolage Grotesque\';font-size:22px">Inizia l\'orale</b><span class="note" style="font-size:14px">Una domanda a caso su ' + esc(c ? c.titolo : m.nome) + '. Rispondi a voce: il voto lo decide la commissione.</span>' +
      (c ? '<button class="linkap" id="o-tutte">usa tutta la materia</button>' : '') + notaAI() + (AI.voce ? '<span class="note">Colloquio a voce: parli liberamente, la commissione ti ascolta e ti risponde.</span>' : usaSR ? '' : '<span class="note">Rispondi a voce con il 🎤 della tastiera: il testo compare mentre parli.</span>') + '</div>';
  }
  if (ult.length) h += '<div class="sez">Ultimi orali</div><div class="card" style="gap:8px">' + ult.map(function (o) { return '<div class="li"><span>' + esc(o.domanda.slice(0, 70)) + (o.domanda.length > 70 ? '…' : '') + '<br><span class="note">' + giornoIt(o.data) + '</span></span><b>' + (o.voto >= 18 ? o.voto + (o.lode ? 'L' : '') + '/30' : 'Non sup.') + '</b></div>'; }).join('') + '</div>';
  v.innerHTML = h;
  v.querySelectorAll('[data-mat]').forEach(function (b) { b.onclick = function () { S.ultimaMateria = b.dataset.mat; S.oraleCid = null; salva(); vOrale(); }; });
  var t = $('o-tutte'); if (t) t.onclick = function () { S.oraleCid = null; salva(); vOrale(); };
  var g = $('o-go'); if (g) g.onclick = function () { $('o-box').style.cssText = ''; iniziaOrale(m.id, dom[Math.floor(Math.random() * dom.length)]); };
}

// ---------- notifiche (app aggiunta alla schermata Home) ----------
function inHome() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function statoNotifiche() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return inHome() ? 'no' : 'installa';
  if (!AI.vapid) return 'no';
  if (Notification.permission === 'granted') return S.notifiche ? 'attive' : 'da-attivare';
  if (Notification.permission === 'denied') return 'negate';
  return 'da-attivare';
}
function chiaveB64(b) { var p = '='.repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
function iscrivi() {
  return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiaveB64(AI.vapid) }); }); })
    .then(function (sub) { return api('/api/notifiche', { uid: S.uid, sub: sub.toJSON() }); });
}
function attivaNotifiche() {
  Notification.requestPermission().then(function (p) {
    if (p !== 'granted') { toast('Notifiche non attivate: puoi riattivarle dalle impostazioni del telefono.'); rerender(); return; }
    return iscrivi().then(function () { S.notifiche = true; salva(); toast('Fatto: ti avviso quando una dispensa è pronta'); rerender(); });
  }).catch(function () { toast('Non riesco ad attivare le notifiche.'); });
}
function boxNotifiche() {
  var st = statoNotifiche();
  if (st === 'da-attivare') return '<button class="dc" data-notif style="flex-direction:row;align-items:center;gap:12px;text-align:left;border:2px solid var(--navy);cursor:pointer;color:var(--ink)"><span style="font-size:24px">🔔</span><span><b style="font-size:15px">Avvisami quando la dispensa è pronta</b><br><span class="note">Una notifica sul telefono, anche ad app chiusa</span></span></button>';
  if (st === 'installa') return '<div class="note" style="text-align:center">Per ricevere una notifica quando la dispensa è pronta, aggiungi UniLampo alla schermata Home.</div>';
  if (st === 'negate') return '<div class="note" style="text-align:center">Le notifiche sono bloccate: attivale dalle impostazioni del telefono per essere avvisata.</div>';
  return '';
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});

// ---------- avvio ----------
leggiStato().then(function () {
  rerender();
  if (S.notifiche && 'Notification' in window && Notification.permission === 'granted' && AI.vapid) iscrivi().catch(function () {});
});
var daNotifica = (location.search.match(/[?&]d=([a-z0-9-]{4,60})/) || [])[1];
if (daNotifica) { history.replaceState(null, '', '/'); setTimeout(function () { if (S.caricamenti.some(function (c) { return c.id === daNotifica; })) mostra('dispensa', daNotifica); }, 300); }
// Al rientro nell'app ricarica in silenzio le dispense dal server (servono a test, orale e ripasso).
S.caricamenti.forEach(function (c) {
  dispCarica(c.id).then(function (d) {
    var L = d && d.lavoro;
    if (c.stato !== 'pronta' && L && (L.fine || (!L.errore && Date.now() - (L.agg || 0) < 5 * 60000))) segui(c); // lavoro sul server: lo seguo
    if (cur.view !== 'orale' && !T) rerender();
  });
});
mostra('studia');
