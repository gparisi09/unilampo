/* UniLampo · beta — dai tuoi appunti a dispense, test e orale. */
'use strict';
var $ = function (id) { return document.getElementById(id); };
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// Segni della dispensa: [[g|..]] giallo, [[c|..]] celeste, [[r|..]] rosa, [[u|..]] sottolineato, [n] fonte.
function marca(t) {
  return esc(t).replace(/\[\[([gcru])\|([^\]]{1,300})\]\]/g, function (m, k, x) { return '<span class="' + { g: 'hl', c: 'hb', r: 'hr', u: 'ul' }[k] + '">' + x + '</span>'; })
    .replace(/\[(\d{1,2})\]/g, '<button type="button" class="cit" data-fonte="$1">[$1]</button>');
}
function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, 2600); }
function dollari(x) { x = Number(x) || 0; if (x > 0 && x < 0.001) return 'meno di $0,001'; return '$' + (x < 0.1 ? x.toFixed(3) : x.toFixed(2)).replace('.', ','); }
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

// ---------- AI: stato, regole di costo, stima ----------
var AI = { accesa: false, chiave: false, pin: false, speso: 0, tetto: 0, regole: null, letto: false };
function leggiStato() { return api('/api/stato').then(function (r) { r.letto = true; AI = r; return r; }).catch(function () { AI.letto = true; return AI; }); }
// Stessa formula del server (netlify/lib/regole.mjs): ingresso stimato + uscita massima + ricerche.
function stima(passo, o) {
  var R = AI.regole; if (!R) return 0; o = o || {};
  var mod = (passo === 'capitolo' || passo === 'mappa') ? R.COSTOSO : R.ECONOMICO, p = R.PREZZI[mod];
  var tok = Math.ceil((o.caratteri || 0) / R.CARATTERI_PER_TOKEN), ric = o.ricerche || 0;
  var pa = mod === R.COSTOSO ? (o.cacheLetta ? p.cacheR : p.cacheW) : p.in;
  return (tok * pa + (R.INGRESSO_FISSO[passo] + ric * R.TOKEN_PER_RICERCA) * p.in + R.USCITA[passo] * p.out) / 1e6 + ric * R.PREZZO_RICERCA;
}
function nomeModello(m) { return /haiku/.test(m) ? 'modello economico' : 'modello avanzato'; }
function genera(cid, passo, extra) {
  var b = Object.assign({ uid: S.uid, cid: cid, passo: passo }, extra || {});
  return api('/api/genera', b).then(function (r) { if (r.usd) AI.speso = Math.round((AI.speso + r.usd) * 1e5) / 1e5; return r; });
}
function erroreAI(e) {
  if (e && e.error === 'spenta') return "Il generatore AI è spento. Accendilo dalle impostazioni (serve il PIN).";
  if (e && e.error === 'tetto') return 'Raggiunto il tetto di spesa di oggi (' + dollari(e.tetto) + '). Riprova domani.';
  if (e && e.error === 'parse') return 'Risposta non valida dal modello: riprova.';
  if (e && e.error === 'upstream') return 'Anthropic non risponde (' + (e.status || '') + '): controlla chiave e credito.';
  return 'Qualcosa non ha funzionato: riprova tra poco.';
}

// ---------- navigazione ----------
var cur = { view: 'materie', tab: 'materie' }, VIEWS = ['materie', 'materia', 'carica', 'dispense', 'dispensa', 'test', 'orale', 'ripasso', 'set'];
var TABOF = { materie: 'materie', materia: 'materie', carica: 'materie', set: 'materie', dispense: 'dispense', dispensa: 'dispense', test: 'test', orale: 'orale', ripasso: 'ripasso' };
function mostra(v, arg) {
  if (cur.view === 'orale' && v !== 'orale') fermaOrale();
  cur.view = v; cur.arg = arg; cur.tab = TABOF[v];
  VIEWS.forEach(function (x) { $('v-' + x).classList.toggle('on', x === v); });
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === cur.tab); });
  ({ materie: vMaterie, materia: vMateria, carica: vCarica, dispense: vDispense, dispensa: vDispensa, test: vTest, orale: vOrale, ripasso: vRipasso, set: vSet })[v](arg);
  window.scrollTo(0, 0);
}
function rerender() { mostra(cur.view, cur.arg); }
document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { mostra(b.dataset.tab); }); });
$('go-home').addEventListener('click', function () { mostra('materie'); });
$('go-set').addEventListener('click', function () { mostra('set'); });
function sheet(html, onOpen) { $('sheet-in').innerHTML = '<div class="grab"></div>' + html; $('sheet').classList.add('on'); document.body.style.overflow = 'hidden'; if (onOpen) onOpen($('sheet-in')); }
function chiudiSheet() { $('sheet').classList.remove('on'); document.body.style.overflow = ''; }
$('sheet').addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) chiudiSheet(); });
document.addEventListener('focusin', function (e) { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) document.body.classList.add('kb'); });
document.addEventListener('focusout', function () { setTimeout(function () { if (!/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) document.body.classList.remove('kb'); }, 50); });

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

// ---------- MATERIE (home) ----------
function vMaterie() {
  var v = $('v-materie'), due = daRipassare(), h = '';
  if (due.length) h += '<div class="dark"><span class="lab">Oggi</span><div class="big">Ripassa le <em>' + due.length + ' domand' + (due.length === 1 ? 'a' : 'e') + '</em> che hai sbagliato</div><button class="btn small" style="align-self:flex-start" data-act="ripasso-oggi">Inizia il ripasso</button></div>';
  h += '<div class="card"><div class="flex"><span class="lab">Le tue materie</span><span class="note">' + S.materie.length + (S.materie.length === 1 ? ' materia' : ' materie') + '</span></div>';
  if (!S.materie.length) h += '<div class="note" style="font-size:14px">Aggiungi le materie che stai preparando, poi carica gli appunti di ognuna.</div>';
  S.materie.forEach(function (m) {
    var st = statMateria(m.id), car = carDi(m.id), debole = st.tot >= 5 && st.pct < 60, nq = domandeMateria(m.id).length;
    h += '<button class="matbtn' + (debole ? ' debole' : '') + '" data-mat="' + m.id + '"><span class="mt"><b>' + esc(m.nome) + '</b>' + (debole ? '<span class="tag red">Da rinforzare</span>' : '<span class="go">' + (st.pct === null ? 'Apri' : st.pct + '%') + ' →</span>') + '</span>' +
      '<span class="bar"><i class="' + (debole ? 'low' : '') + '" style="width:' + (st.pct || 0) + '%"></i></span>' +
      '<span class="note">' + car.length + (car.length === 1 ? ' dispensa' : ' dispense') + ' · ' + nq + ' domande' + (st.tot ? ' · ' + st.tot + ' risposte date' : '') + '</span></button>';
  });
  h += '<div class="row"><button class="btn ghost small" data-act="nuova-materia" style="color:var(--blu)">+ Materia</button>' + (S.materie.length ? '<button class="btn" data-act="carica">+ Carica appunti</button>' : '') + '</div></div>';
  h += cardAI();
  v.innerHTML = h;
  v.querySelectorAll('[data-mat]').forEach(function (b) { b.onclick = function () { mostra('materia', b.dataset.mat); }; });
  azioni(v);
}
function cardAI() {
  if (!AI.letto) return '';
  var s = AI.accesa ? 'Acceso' : 'Spento';
  return '<button class="dark" data-act="set" style="border:0;text-align:left;width:100%;color:var(--ink)"><span class="flex" style="width:100%"><span><span class="lab">Generatore AI</span><br><b style="font-size:15px">' + s + '</b></span><span class="sw' + (AI.accesa ? ' on' : '') + '"></span></span>' +
    '<span class="note">Tetto di oggi ' + dollari(AI.tetto) + ' · speso ' + dollari(AI.speso) + '. Quello che è già generato resta usabile gratis.</span></button>';
}
function azioni(root) {
  root.querySelectorAll('[data-act]').forEach(function (b) {
    b.onclick = function () {
      var a = b.dataset.act;
      if (a === 'nuova-materia') nuovaMateria();
      else if (a === 'carica') mostra('carica', b.dataset.m || (cur.view === 'materia' ? cur.arg : null));
      else if (a === 'set') mostra('set');
      else if (a === 'ripasso-oggi') avviaTest({ tipo: 'ripasso', mid: b.dataset.m || null });
    };
  });
}
function nuovaMateria() {
  sheet('<h2 style="font-size:22px">Nuova materia</h2><div class="field"><label for="nm">Nome della materia</label><input id="nm" maxlength="80" placeholder="es. Diritto privato" autocomplete="off"></div><button class="btn" id="nm-ok">Aggiungi</button><button class="btn ghost" data-close style="color:var(--blu2)">Annulla</button>', function (r) {
    var i = r.querySelector('#nm'); setTimeout(function () { i.focus(); }, 100);
    var ok = function () { var n = i.value.trim(); if (!n) return; S.materie.push({ id: nid('m'), nome: n }); salva(); chiudiSheet(); rerender(); };
    r.querySelector('#nm-ok').onclick = ok; i.onkeydown = function (e) { if (e.key === 'Enter') ok(); };
    r.querySelector('[data-close]').onclick = chiudiSheet;
  });
}

// ---------- MATERIA ----------
function vMateria(mid) {
  var m = materia(mid), v = $('v-materia'); if (!m) return mostra('materie');
  var st = statMateria(mid), car = carDi(mid), due = daRipassare(mid), h = '<button class="back" data-b>← Materie</button><h2 style="font-size:25px">' + esc(m.nome) + '</h2>';
  h += '<div class="kpis"><div class="kpi"><b>' + (st.pct === null ? '–' : st.pct + '%') + '</b><span>risposte giuste</span></div><div class="kpi"><b>' + due.length + '</b><span>da ripassare oggi</span></div></div>';
  h += '<div class="card"><span class="lab">Dispense</span>';
  if (!car.length) h += '<span class="note" style="font-size:14px">Nessun appunto caricato. Carica un PDF o incolla il testo: ne nasce una dispensa con mappa, fonti e domande.</span>';
  car.forEach(function (c) { h += '<button class="li" data-c="' + c.id + '"><span><b>' + esc(c.titolo || c.file || 'Appunti') + '</b><br><span class="note">' + statoCar(c) + '</span></span><span>→</span></button>'; });
  h += '<button class="btn" data-act="carica" data-m="' + mid + '">+ Carica appunti</button></div>';
  if (domandeMateria(mid).length) h += '<div class="row"><button class="btn v" data-t>Test della materia</button><button class="btn ghost" data-o style="color:var(--blu)">Orale</button></div>';
  h += '<button class="btn ghost small" data-del style="color:var(--kob);align-self:flex-start">Elimina materia</button>';
  v.innerHTML = h;
  v.querySelector('[data-b]').onclick = function () { mostra('materie'); };
  v.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { apriCar(b.dataset.c); }; });
  var t = v.querySelector('[data-t]'); if (t) t.onclick = function () { avviaTest({ tipo: 'materia', mid: mid }); };
  var o = v.querySelector('[data-o]'); if (o) o.onclick = function () { S.ultimaMateria = mid; mostra('orale'); };
  v.querySelector('[data-del]').onclick = function () {
    if (!confirm('Eliminare ' + m.nome + ' con le sue dispense?')) return;
    carDi(mid).forEach(function (c) { api('/api/caricamento?uid=' + S.uid + '&cid=' + c.id, null, 'DELETE').catch(function () {}); try { localStorage.removeItem('ul-d-' + c.id); } catch (e) {} });
    S.caricamenti = S.caricamenti.filter(function (c) { return c.materiaId !== mid; }); S.materie = S.materie.filter(function (x) { return x.id !== mid; }); salva(); mostra('materie');
  };
  azioni(v);
}
function statoCar(c) { return c.stato === 'pronta' ? 'Dispensa pronta · ' + giornoIt(c.data) : c.stato === 'argomenti' ? 'Argomenti trovati: manca la dispensa' : c.stato === 'parziale' ? 'Dispensa a metà: tocca per completarla' : 'Appunti caricati: trova gli argomenti'; }
function giornoIt(d) { return d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''; }
function apriCar(cid) { var c = S.caricamenti.find(function (x) { return x.id === cid; }); if (!c) return; if (c.stato === 'pronta') mostra('dispensa', cid); else mostra('carica', { cid: cid }); }

// ---------- CARICA APPUNTI ----------
var CAR = null; // caricamento in corso nella schermata
function vCarica(arg) {
  var v = $('v-carica');
  if (arg && arg.cid) { var c = S.caricamenti.find(function (x) { return x.id === arg.cid; }); if (!c) return mostra('materie'); return passiCaricamento(c); }
  if (!S.materie.length) { mostra('materie'); return nuovaMateria(); }
  var mid = arg || S.ultimaMateria || S.materie[0].id;
  CAR = { mid: mid, testo: '', file: '', titolo: '' };
  var opts = S.materie.map(function (m) { return '<option value="' + m.id + '"' + (m.id === mid ? ' selected' : '') + '>' + esc(m.nome) + '</option>'; }).join('');
  v.innerHTML = '<button class="back" data-b>← Indietro</button><h2 style="font-size:25px">Nuovi appunti</h2>' +
    '<div class="card"><div class="field"><label for="c-mat">Materia</label><select id="c-mat">' + opts + '</select></div>' +
    '<label class="drop" id="c-drop"><input type="file" id="c-file" accept=".pdf,.txt,.md,application/pdf,text/plain">Scegli un PDF o un file di testo</label>' +
    '<div id="c-letto"></div>' +
    '<details><summary class="note" style="cursor:pointer;font-size:13.5px">Oppure incolla il testo</summary><textarea class="in" id="c-txt" rows="7" placeholder="Incolla qui i tuoi appunti" style="margin-top:8px"></textarea></details>' +
    '<div class="field"><label for="c-tit">Titolo (facoltativo)</label><input id="c-tit" maxlength="100" placeholder="es. Lezione 4 · Elasticità"></div>' +
    '<button class="btn" id="c-go" disabled>Continua</button><span class="note">Gli appunti vengono letti sul telefono e salvati solo nel tuo spazio. Nessuna generazione parte senza che tu veda prima la stima.</span></div>';
  v.querySelector('[data-b]').onclick = function () { if (materia(mid)) mostra('materia', mid); else mostra('materie'); };
  var go = $('c-go'), aggiorna = function () { var t = (CAR.testo || $('c-txt').value).trim(); go.disabled = t.length < 200; };
  $('c-txt').oninput = function () { CAR.testo = ''; CAR.file = ''; $('c-letto').innerHTML = ''; aggiorna(); };
  $('c-file').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    $('c-letto').innerHTML = '<div class="file"><span class="spin"></span><span>Leggo ' + esc(f.name) + '…</span></div>';
    leggiFile(f).then(function (r) {
      CAR.testo = r.testo; CAR.file = f.name;
      if (!$('c-tit').value) $('c-tit').value = f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 100);
      var poco = r.testo.trim().length < 200;
      $('c-letto').innerHTML = '<div class="file"><i>' + (/pdf$/i.test(f.name) ? 'PDF' : 'TXT') + '</i><div><b>' + esc(f.name) + '</b><div class="note">' + (r.pagine ? r.pagine + ' pagine · ' : '') + r.testo.length.toLocaleString('it-IT') + ' caratteri letti</div></div></div>' +
        (poco ? '<div class="box tr"><span class="t">Testo non trovato</span>Questo PDF sembra una scansione (immagini, non testo). Per ora UniLampo legge solo PDF con testo selezionabile: prova a esportarlo di nuovo o incolla il testo.</div>' : '') +
        (r.testo.length > ((AI.regole && AI.regole.MAX_CARATTERI_APPUNTI) || 60000) ? '<div class="note">Gli appunti sono lunghi: verranno usati i primi ' + ((AI.regole && AI.regole.MAX_CARATTERI_APPUNTI) || 60000).toLocaleString('it-IT') + ' caratteri. Per il resto fai un secondo caricamento.</div>' : '');
      aggiorna();
    }).catch(function () { $('c-letto').innerHTML = '<div class="box tr"><span class="t">Non riesco a leggerlo</span>Prova con un altro file o incolla il testo.</div>'; });
  };
  go.onclick = function () {
    var testo = (CAR.testo || $('c-txt').value).trim(), mid2 = $('c-mat').value, cid = nid('c');
    go.disabled = true; go.innerHTML = '<span class="spin"></span>';
    api('/api/caricamento', { uid: S.uid, cid: cid, materia: (materia(mid2) || {}).nome, titolo: $('c-tit').value.trim(), file: CAR.file, testo: testo }).then(function (r) {
      var c = { id: cid, materiaId: mid2, titolo: $('c-tit').value.trim() || CAR.file || 'Appunti', file: CAR.file, data: new Date().toISOString(), caratteri: r.caratteri, stato: 'nuovo' };
      S.caricamenti.push(c); S.ultimaMateria = mid2; salva(); passiCaricamento(c);
    }).catch(function (e) { go.disabled = false; go.textContent = 'Continua'; toast(e && e.error === 'corto' ? 'Gli appunti sono troppo corti.' : 'Non riesco a salvare: controlla la connessione.'); });
  };
}
var pdfjs = null;
function leggiFile(f) {
  if (!/pdf$/i.test(f.name) && f.type !== 'application/pdf') return f.text().then(function (t) { return { testo: t }; });
  var carica = pdfjs ? Promise.resolve(pdfjs) : import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(function (m) { m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'; pdfjs = m; return m; });
  return Promise.all([carica, f.arrayBuffer()]).then(function (x) {
    return x[0].getDocument({ data: x[1] }).promise.then(function (doc) {
      var pagine = [], p = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) (function (n) { p = p.then(function () { return doc.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) { pagine.push(tc.items.map(function (it) { return it.str + (it.hasEOL ? '\n' : ' '); }).join('')); }); }); })(i);
      return p.then(function () { return { testo: pagine.join('\n\n').replace(/[ \t]+/g, ' '), pagine: doc.numPages }; });
    });
  });
}
function passiCaricamento(c) {
  var v = $('v-carica'); cur.arg = { cid: c.id };
  v.innerHTML = '<button class="back" data-b>← ' + esc((materia(c.materiaId) || {}).nome || 'Indietro') + '</button><h2 style="font-size:24px">' + esc(c.titolo) + '</h2><div id="p-corpo"><div class="card"><span class="spin"></span></div></div>';
  v.querySelector('[data-b]').onclick = function () { mostra('materia', c.materiaId); };
  Promise.all([dispCarica(c.id), AI.regole ? AI : leggiStato()]).then(function (x) { disegnaPassi(c, x[0]); });
}
function disegnaPassi(c, d) {
  var box = $('p-corpo'); if (!box || !d) { if (box) box.innerHTML = '<div class="empty">Non trovo questo caricamento.</div>'; return; }
  var R = AI.regole, h = '';
  h += '<div class="card"><div class="file"><i>' + (/pdf$/i.test(c.file || '') ? 'PDF' : 'TXT') + '</i><div><b>' + esc(c.file || c.titolo) + '</b><div class="note">' + (d.caratteri || 0).toLocaleString('it-IT') + ' caratteri</div></div></div>';
  if (!d.argomenti.length) {
    var s1 = stima('argomenti', { caratteri: d.caratteri });
    h += '<span class="lab">1 · Trova gli argomenti</span><table class="est"><tr><td>Lettura degli appunti<br><span class="note">' + nomeModello(R && R.ECONOMICO) + '</span></td><td>' + dollari(s1) + '</td></tr><tr class="tot"><td>Stima massima</td><td>' + dollari(s1) + '</td></tr></table>' +
      notaAI() + '<button class="btn" id="p-arg"' + (AI.accesa ? '' : ' disabled') + '>Trova gli argomenti</button></div>';
    box.innerHTML = h;
    var b = $('p-arg'); if (b) b.onclick = function () {
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Leggo gli appunti…';
      genera(c.id, 'argomenti').then(function (r) { d.argomenti = r.dato.argomenti; d.titolo = r.dato.titolo; c.stato = 'argomenti'; if (r.dato.titolo && (!c.titolo || c.titolo === c.file || c.titolo === String(c.file || '').replace(/\.[a-z0-9]+$/i, ''))) c.titolo = r.dato.titolo; salva(); dispSalva(c.id, d); var h2 = document.querySelector('#v-carica h2'); if (h2) h2.textContent = c.titolo; disegnaPassi(c, d); })
        .catch(function (e) { b.disabled = false; b.textContent = 'Trova gli argomenti'; toast(erroreAI(e)); });
    };
    return;
  }
  h += '<span class="lab">Argomenti trovati (' + d.argomenti.length + ')</span><div class="chips">' + d.argomenti.map(function (a) { return '<span class="chip on">' + esc(a.titolo) + '</span>'; }).join('') + '</div></div>';
  // stima della dispensa, contando solo i passaggi che mancano
  var n = d.argomenti.length, righe = { ricerca: 0, capitolo: 0, domande: 0, mappa: 0 };
  for (var i = 0; i < n; i++) {
    if (!d.ricerca[i]) righe.ricerca += stima('ricerca', { ricerche: R.RICERCHE_PER_ARGOMENTO });
    if (!d.capitoli[i]) righe.capitolo += stima('capitolo', { caratteri: d.caratteri, cacheLetta: i > 0 });
    if (!d.domande[i]) righe.domande += stima('domande');
  }
  if (!d.mappa) righe.mappa = stima('mappa');
  var tot = righe.ricerca + righe.capitolo + righe.domande + righe.mappa;
  h += '<div class="card"><span class="lab">2 · Dispensa · stima prima di generare</span><table class="est">' +
    '<tr><td>Ricerca fonti<br><span class="note">max ' + R.MAX_FONTI_PER_ARGOMENTO + ' fonti per argomento · ' + R.RICERCHE_PER_ARGOMENTO + ' ricerche web · ' + nomeModello(R.ECONOMICO) + '</span></td><td>' + dollari(righe.ricerca) + '</td></tr>' +
    '<tr><td>Scrittura dispensa e mappa<br><span class="note">' + nomeModello(R.COSTOSO) + '</span></td><td>' + dollari(righe.capitolo + righe.mappa) + '</td></tr>' +
    '<tr><td>Domande del test e dell\'orale<br><span class="note">' + nomeModello(R.ECONOMICO) + '</span></td><td>' + dollari(righe.domande) + '</td></tr>' +
    '<tr class="tot"><td>Stima massima</td><td>≈ ' + dollari(tot) + '</td></tr></table>' +
    '<span class="note">Si genera una volta e resta salvata. Le parti già pronte non si pagano di nuovo. Tetto di oggi: ' + dollari(AI.tetto) + ', speso ' + dollari(AI.speso) + '.</span>' + notaAI() +
    '<div class="steps" id="p-steps"></div><button class="btn v" id="p-go"' + (AI.accesa ? '' : ' disabled') + '>' + (c.stato === 'parziale' ? 'Completa la dispensa' : 'Genera dispensa') + '</button></div>';
  box.innerHTML = h;
  disegnaSteps(d);
  var g = $('p-go'); if (g) g.onclick = function () { g.disabled = true; g.innerHTML = '<span class="spin"></span> Sto preparando la dispensa…'; costruisci(c, d).then(function (okTutto) { if (okTutto) { c.stato = 'pronta'; salva(); toast('Dispensa pronta'); mostra('dispensa', c.id); } else { c.stato = 'parziale'; salva(); g.disabled = false; g.textContent = 'Riprova da dove si è fermata'; } }); };
}
function notaAI() { return AI.accesa ? '' : '<div class="box tr"><span class="t">Generatore AI spento</span>' + (AI.chiave ? 'Accendilo dalle impostazioni con il PIN.' : 'Manca la chiave Anthropic su Netlify.') + '</div>'; }
function elencoPassi(d) {
  var o = [];
  d.argomenti.forEach(function (a, i) { o.push({ passo: 'ricerca', i: i, nome: 'Fonti · ' + a.titolo, fatto: !!d.ricerca[i] }); o.push({ passo: 'capitolo', i: i, nome: 'Capitolo ' + (i + 1) + ' · ' + a.titolo, fatto: !!d.capitoli[i] }); o.push({ passo: 'domande', i: i, nome: 'Domande · ' + a.titolo, fatto: !!d.domande[i] }); });
  o.push({ passo: 'mappa', i: 0, nome: 'Mappa a colori', fatto: !!d.mappa });
  return o;
}
function disegnaSteps(d, ora, err) {
  var el = $('p-steps'); if (!el) return;
  el.innerHTML = elencoPassi(d).map(function (p, k) { var cl = p.fatto ? 'fatto' : k === ora ? (err ? 'err' : 'ora') : ''; return '<div class="' + cl + '"><i>' + (p.fatto ? '✓' : k === ora ? (err ? '!' : '…') : k + 1) + '</i><span>' + esc(p.nome) + '</span></div>'; }).join('');
}
function costruisci(c, d) {
  var lista = elencoPassi(d), k = 0;
  var prossimo = function () {
    while (k < lista.length && lista[k].fatto) k++;
    if (k >= lista.length) return Promise.resolve(true);
    var p = lista[k]; disegnaSteps(d, k);
    return genera(c.id, p.passo, { indice: p.i }).then(function (r) {
      if (p.passo === 'ricerca') d.ricerca[p.i] = r.dato; else if (p.passo === 'capitolo') d.capitoli[p.i] = r.dato; else if (p.passo === 'domande') d.domande[p.i] = r.dato; else d.mappa = r.dato;
      if (r.fonti) d.fonti = r.fonti;
      p.fatto = true; dispSalva(c.id, d); k++; return prossimo();
    }).catch(function (e) { disegnaSteps(d, k, true); toast(erroreAI(e)); return false; });
  };
  return prossimo();
}

// ---------- DISPENSE ----------
function vDispense() {
  var v = $('v-dispense'), h = '<h2 style="font-size:25px;margin-top:4px">Dispense</h2>';
  if (!S.caricamenti.length) h += '<div class="empty"><b>Ancora nessuna dispensa</b><span>Carica gli appunti di una materia: UniLampo trova gli argomenti, cerca fonti affidabili e scrive la dispensa con mappa e domande.</span><button class="btn" data-act="carica">+ Carica appunti</button></div>';
  S.materie.forEach(function (m) {
    var car = carDi(m.id); if (!car.length) return;
    h += '<div class="card"><span class="lab">' + esc(m.nome) + '</span>' + car.map(function (c) { return '<button class="li" data-c="' + c.id + '"><span><b>' + esc(c.titolo) + '</b><br><span class="note">' + statoCar(c) + '</span></span><span>→</span></button>'; }).join('') + '</div>';
  });
  v.innerHTML = h;
  v.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { apriCar(b.dataset.c); }; });
  azioni(v);
}
function vDispensa(cid) {
  var v = $('v-dispensa'), c = S.caricamenti.find(function (x) { return x.id === cid; }); if (!c) return mostra('dispense');
  var d = dispLocale(cid);
  if (!d) { v.innerHTML = '<div class="card"><span class="spin"></span></div>'; dispCarica(cid).then(function (x) { if (x) vDispensa(cid); else v.innerHTML = '<div class="empty">Dispensa non trovata.</div>'; }); return; }
  var h = '<div class="flex"><button class="back" data-b>← Dispense</button><span class="tag">Salvata</span></div><div><span class="lab">' + esc((materia(c.materiaId) || {}).nome || d.materia) + '</span><h2 style="font-size:24px">' + esc(c.titolo || d.titolo) + '</h2></div>';
  h += '<div class="paper"><div class="legend"><span><s style="background:var(--y)"></s>concetto chiave</span><span><s style="background:var(--b)"></s>definizione</span><span><s style="background:var(--r)"></s>attenzione</span><span><u style="text-decoration-color:var(--u);text-decoration-thickness:2px">formula</u></span></div>';
  if (d.mappa && d.mappa.rami && d.mappa.rami.length) {
    h += '<div class="map"><div class="core">' + esc(d.mappa.centro || c.titolo) + '</div>' + d.mappa.rami.map(function (r, k) {
      var key = 'r' + k, gia = d.approfondimenti[key];
      return '<div class="node c' + ((k % 6) + 1) + '"><b>' + esc(r.titolo) + '</b><span>' + esc(r.testo) + '</span><button type="button" class="ap" data-ap="' + key + '" data-cap="' + Math.max(0, r.capitolo - 1) + '" data-txt="' + esc(r.titolo + ': ' + r.testo) + '">' + (gia ? 'Approfondito ✓' : 'Approfondisci ↗') + '</button></div>';
    }).join('') + '</div>';
  }
  var nCap = d.argomenti.length;
  h += '<span class="lab" style="margin-top:4px">Indice</span><div class="toc">' + d.argomenti.map(function (a, i) { return '<button type="button" data-goto="cap' + i + '"><span class="n" style="font-weight:700;color:var(--blu)">' + (i + 1) + '</span>' + esc((d.capitoli[i] || a).titolo) + '</button>'; }).join('') + '</div></div>';
  for (var i = 0; i < nCap; i++) {
    var cp = d.capitoli[i]; if (!cp) continue;
    h += '<div class="paper c' + ((i % 6) + 1) + '" id="cap' + i + '"><h3><span class="n">' + (i + 1) + '</span>' + esc(cp.titolo) + '</h3>';
    cp.paragrafi.forEach(function (p, j) {
      var key = 'c' + i + 'p' + j, ap = d.approfondimenti[key];
      h += '<p>' + marca(p) + '</p><button type="button" class="apbtn' + (ap ? ' salvato' : '') + '" data-ap="' + key + '" data-cap="' + i + '" data-txt="' + esc(p.replace(/\[\[[gcru]\|([^\]]*)\]\]/g, '$1')) + '">' + (ap ? '✓ Approfondimento salvato' : '✦ Approfondisci') + '</button>';
      if (ap) h += boxApp(ap);
    });
    if (cp.esempio) h += '<div class="box es"><span class="t">Esempio</span>' + marca(cp.esempio) + '</div>';
    if (cp.trappola) h += '<div class="box tr"><span class="t">Trappola</span>' + marca(cp.trappola) + '</div>';
    if (cp.ricorda) h += '<div class="box rem"><span class="t">Da ricordare</span>' + marca(cp.ricorda) + '</div>';
    if (cp.confronto && cp.confronto.length) {
      h += '<span class="lab">Appunti a confronto con le fonti</span><div class="cmp">' + cp.confronto.map(function (x) {
        var ic = x.tipo === 'ok' ? '<i class="ic i-ok">✓</i>' : x.tipo === 'incompleto' ? '<i class="ic i-w">!</i>' : '<i class="ic i-no">≠</i>';
        var pre = x.tipo === 'incompleto' ? '<b>Incompleto:</b> ' : x.tipo === 'diverso' ? '<b>Diverso:</b> ' : '';
        return '<div>' + ic + '<span>' + pre + marca(x.testo) + '</span></div>';
      }).join('') + '</div>';
    }
    var mie = (d.ricerca[i] && d.ricerca[i].nums) || [];
    if (mie.length) h += '<div class="srcs"><span class="t">Fonti di questo capitolo</span>' + mie.map(function (n) { var f = (d.fonti || []).find(function (x) { return x.n === n; }); return f ? '<span>[' + n + '] <a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.titolo) + '</a>' + (f.sito ? ' · ' + esc(f.sito) : '') + '</span>' : ''; }).join('') + '</div>';
    else h += '<div class="srcs"><span class="t">Fonti</span><span>Per questo argomento la ricerca non ha trovato fonti affidabili: il capitolo si basa solo sui tuoi appunti.</span></div>';
    h += '</div>';
  }
  var nq = domandeDi(cid).length;
  h += '<div class="card"><span class="lab">Tutte le fonti</span><div class="srcs" style="background:none;padding:0">' + ((d.fonti || []).length ? d.fonti.map(function (f) { return '<span id="f' + f.n + '">[' + f.n + '] <a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.titolo) + '</a>' + (f.tipo ? ' · ' + esc(f.tipo) : '') + '</span>'; }).join('') : '<span>Nessuna fonte esterna.</span>') + '</div></div>';
  h += '<button class="btn" data-ver' + (nq ? '' : ' disabled') + '>Verifica finale · ' + nq + ' domande</button>';
  h += '<button class="btn ghost small" data-del style="color:var(--kob);align-self:flex-start">Elimina questa dispensa</button>';
  v.innerHTML = h;
  v.querySelector('[data-b]').onclick = function () { mostra('dispense'); };
  v.querySelectorAll('[data-goto]').forEach(function (b) { b.onclick = function () { var e = $(b.dataset.goto); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
  v.querySelectorAll('[data-ap]').forEach(function (b) { b.onclick = function () { approfondisci(c, d, b.dataset.ap, +b.dataset.cap, b.dataset.txt); }; });
  v.querySelectorAll('[data-fonte]').forEach(function (b) { b.onclick = function () { mostraFonte(d, +b.dataset.fonte); }; });
  v.querySelector('[data-ver]').onclick = function () { avviaTest({ tipo: 'verifica', cid: cid }); };
  v.querySelector('[data-del]').onclick = function () {
    if (!confirm('Eliminare questa dispensa? Le risposte date restano nelle statistiche.')) return;
    api('/api/caricamento?uid=' + S.uid + '&cid=' + cid, null, 'DELETE').catch(function () {}); try { localStorage.removeItem('ul-d-' + cid); } catch (e) {}
    S.caricamenti = S.caricamenti.filter(function (x) { return x.id !== cid; }); salva(); mostra('dispense');
  };
}
function boxApp(ap) {
  return '<div class="box app"><span class="t">Approfondimento · ' + esc(ap.titolo) + '</span>' + ap.paragrafi.map(function (p) { return '<p style="margin:0 0 6px">' + marca(p) + '</p>'; }).join('') +
    ap.esempi.map(function (e) { return '<div class="box es" style="margin-top:6px"><span class="t">Esempio in più</span>' + marca(e) + '</div>'; }).join('') +
    (ap.collegamenti.length ? '<div style="margin-top:6px"><span class="t" style="color:var(--muto)">Collegamenti</span><div class="chips">' + ap.collegamenti.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div></div>' : '') + '</div>';
}
function mostraFonte(d, n) {
  var f = (d.fonti || []).find(function (x) { return x.n === n; }); if (!f) return;
  sheet('<span class="lab">Fonte [' + n + ']</span><h2 style="font-size:20px">' + esc(f.titolo) + '</h2>' + (f.sito ? '<span class="note">' + esc(f.sito) + (f.tipo ? ' · ' + esc(f.tipo) : '') + '</span>' : '') +
    (f.punti && f.punti.length ? '<div class="srcs"><span class="t">Cosa dice di utile</span>' + f.punti.map(function (p) { return '<span>• ' + esc(p) + '</span>'; }).join('') + '</div>' : '') +
    '<a class="btn" href="' + esc(f.url) + '" target="_blank" rel="noopener" style="text-decoration:none">Apri la fonte</a><button class="btn ghost" data-close style="color:var(--blu2)">Chiudi</button>', function (r) { r.querySelector('[data-close]').onclick = chiudiSheet; });
}
function approfondisci(c, d, key, cap, testo) {
  var gia = d.approfondimenti[key];
  if (gia) return sheet('<div class="flex"><span class="lab">Approfondimento</span><span class="tag dark">Nella dispensa ✓</span></div>' + corpoApp(d, gia) + '<span class="note">Generato una volta il ' + giornoIt(gia.data) + '. Riaprirlo non costa nulla.</span><button class="btn v" data-close>Chiudi</button>', function (r) { legaSheet(r, d); });
  var R = AI.regole, s = stima('approfondisci', { ricerche: R ? R.RICERCHE_APPROFONDISCI : 1 });
  sheet('<span class="lab">Approfondisci</span><div style="font-family:\'Bricolage Grotesque\';font-size:17px;line-height:1.3">“' + esc(testo.slice(0, 110)) + (testo.length > 110 ? '…' : '') + '”</div>' +
    '<span class="note">Spiegazione più profonda, esempi, collegamenti con gli altri argomenti di ' + esc((materia(c.materiaId) || {}).nome || 'questa materia') + ', fonti e 3 domande nuove per i test. Si genera una volta e si salva nella dispensa.</span>' +
    '<table class="est"><tr><td>Approfondimento<br><span class="note">' + nomeModello(R && R.ECONOMICO) + ' · max ' + (R ? R.RICERCHE_APPROFONDISCI : 1) + ' ricerca web</span></td><td>' + dollari(s) + '</td></tr><tr class="tot"><td>Stima massima</td><td>' + dollari(s) + '</td></tr></table>' + notaAI() +
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
  else pool = mescola(domandeMateria(o.mid)).sort(function (a, b) { var ra = S.risposte[a.qid], rb = S.risposte[b.qid]; return (ra ? ra.box : -1) - (rb ? rb.box : -1); }).slice(0, 15);
  if (!pool.length) { toast('Nessuna domanda da fare qui.'); return; }
  T = { o: o, lista: mescola(pool).map(function (x) { var ord = mescola([0, 1, 2, 3]); return { qid: x.qid, cid: x.cid, q: x.q, ord: ord }; }), i: 0, ok: 0, risposto: false, inizio: Date.now() };
  mostra('test', { inCorso: true });
}
function vTest(arg) {
  var v = $('v-test');
  if (T && arg && arg.inCorso) return disegnaDomanda();
  T = null;
  var h = '<h2 style="font-size:25px;margin-top:4px">Test</h2>', due = daRipassare();
  if (due.length) h += '<button class="banner" data-rip>Ripasso: ' + due.length + ' domande sbagliate da rifare oggi <span>→</span></button>';
  var conDom = S.materie.filter(function (m) { return domandeMateria(m.id).length; });
  if (!conDom.length) h += '<div class="empty"><b>Nessuna domanda ancora</b><span>Le domande a crocette nascono con ogni dispensa (8 per argomento) e con ogni approfondimento (3).</span></div>';
  conDom.forEach(function (m) {
    var st = statMateria(m.id), car = carDi(m.id).filter(function (c) { return domandeDi(c.id).length; });
    h += '<div class="card"><div class="flex"><b style="font-size:16px">' + esc(m.nome) + '</b><span class="note">' + domandeMateria(m.id).length + ' domande' + (st.pct !== null ? ' · ' + st.pct + '% giuste' : '') + '</span></div>' +
      '<button class="btn v" data-m="' + m.id + '">Test della materia · ' + Math.min(15, domandeMateria(m.id).length) + ' domande</button>' +
      car.map(function (c) { return '<button class="li" data-v="' + c.id + '"><span>Verifica: <b>' + esc(c.titolo) + '</b></span><span class="note">' + domandeDi(c.id).length + ' →</span></button>'; }).join('') + '</div>';
  });
  v.innerHTML = h;
  var r = v.querySelector('[data-rip]'); if (r) r.onclick = function () { avviaTest({ tipo: 'ripasso' }); };
  v.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { avviaTest({ tipo: 'materia', mid: b.dataset.m }); }; });
  v.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { avviaTest({ tipo: 'verifica', cid: b.dataset.v }); }; });
}
function disegnaDomanda() {
  var v = $('v-test'), x = T.lista[T.i];
  if (!x) return fineTest();
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
function fineTest() {
  var v = $('v-test'), n = T.lista.length, pct = Math.round(T.ok / n * 100);
  v.innerHTML = '<div class="card" style="align-items:flex-start"><span class="lab">Risultato</span><div class="score">' + T.ok + '<span style="font-size:22px">/' + n + '</span></div><span>' + pct + '% di risposte giuste. ' + (n - T.ok ? (n - T.ok === 1 ? 'La sbagliata è già nel ripasso.' : 'Le ' + (n - T.ok) + ' sbagliate sono già nel ripasso.') : 'Nessun errore: queste domande torneranno tra qualche giorno per fissarle.') + '</span>' +
    '<div class="row" style="width:100%"><button class="btn v" id="t-ancora">Rifai un test</button><button class="btn ghost" id="t-rip" style="color:var(--blu)">Ripasso</button></div></div>';
  $('t-ancora').onclick = function () { var o = T.o; avviaTest(o.tipo === 'ripasso' ? { tipo: 'materia', mid: S.materie[0] && S.materie[0].id } : o); };
  $('t-rip').onclick = function () { T = null; mostra('ripasso'); };
}

// ---------- ORALE ----------
var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null, O = null;
function vocePiuBella() {
  var vs = ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter(function (x) { return /^it/i.test(x.lang); });
  var rank = function (v) { var n = v.name; return /enhanced|premium|natural|neural/i.test(n) ? 0 : /alice|federica|paola|emma|luca/i.test(n) ? 1 : /google/i.test(n) ? 2 : 3; };
  return vs.sort(function (a, b) { return rank(a) - rank(b); })[0] || null;
}
if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; }
function parla(t) { return new Promise(function (res) { if (!('speechSynthesis' in window)) return res(); try { var u = new SpeechSynthesisUtterance(t); u.lang = 'it-IT'; u.rate = 0.98; var vv = vocePiuBella(); if (vv) u.voice = vv; u.onend = res; u.onerror = res; speechSynthesis.cancel(); speechSynthesis.speak(u); setTimeout(res, Math.min(30000, 2500 + t.length * 90)); } catch (e) { res(); } }); }
function vOrale() {
  var v = $('v-orale'), conOr = S.materie.filter(function (m) { return oraliMateria(m.id).length; });
  if (!conOr.length) { v.innerHTML = '<h2 style="font-size:25px;margin-top:4px">Orale</h2><div class="empty"><b>Nessuna domanda d\'orale ancora</b><span>Ogni dispensa prepara 2 domande d\'orale per argomento, con i punti chiave che la commissione controlla.</span></div>'; return; }
  var mid = conOr.some(function (m) { return m.id === S.ultimaMateria; }) ? S.ultimaMateria : conOr[0].id;
  var dom = oraliMateria(mid), R = AI.regole, st = R ? stima('orale') * 4 : 0, ult = S.orali.filter(function (o) { return o.mid === mid; }).slice(-3).reverse();
  var h = '<div class="flex"><h2 style="font-size:25px;margin-top:4px">Orale</h2></div><div class="chips">' + conOr.map(function (m) { return '<button class="chip' + (m.id === mid ? ' on' : '') + '" data-m="' + m.id + '">' + esc(m.nome) + '</button>'; }).join('') + '</div>' +
    '<div class="comm"><div class="mem" id="m0"><div class="av">P</div>Presidente</div><div class="mem" id="m1"><div class="av">C1</div>Commissario</div><div class="mem" id="m2"><div class="av">C2</div>Assistente</div></div>' +
    '<div class="card" id="o-box"><span class="lab">Come funziona</span><span style="font-size:14px">La commissione ti fa una domanda a voce e può farti fino a due domande di approfondimento. Rispondi parlando. Alla fine il voto e i punti toccati li decide il sistema, non tu.</span>' +
    '<table class="est"><tr><td>Un colloquio (fino a 4 scambi)<br><span class="note">' + nomeModello(R && R.ECONOMICO) + ' · voce del telefono, gratis</span></td><td>' + dollari(st) + '</td></tr><tr class="tot"><td>Stima massima</td><td>' + dollari(st) + '</td></tr></table>' + notaAI() +
    '<button class="btn" id="o-go"' + (AI.accesa ? '' : ' disabled') + '>Inizia l\'orale · domanda a caso</button><span class="note">' + dom.length + ' domande disponibili in questa materia.' + (SR ? '' : ' Su questo browser il riconoscimento vocale non c\'è: risponderai scrivendo, anche con il microfono della tastiera.') + '</span></div>';
  if (ult.length) h += '<div class="card"><span class="lab">Ultimi orali</span>' + ult.map(function (o) { return '<div class="li"><span>' + esc(o.domanda.slice(0, 70)) + (o.domanda.length > 70 ? '…' : '') + '<br><span class="note">' + giornoIt(o.data) + '</span></span><b>' + (o.voto >= 18 ? o.voto + (o.lode ? 'L' : '') + '/30' : 'Non sup.') + '</b></div>'; }).join('') + '</div>';
  v.innerHTML = h;
  v.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { S.ultimaMateria = b.dataset.m; salva(); vOrale(); }; });
  var g = $('o-go'); if (g) g.onclick = function () { iniziaOrale(mid, dom[Math.floor(Math.random() * dom.length)]); };
}
function waveOn(on) { var w = document.querySelector('#o-box .wave'); if (!w) return; clearInterval(waveOn.t); if (on) waveOn.t = setInterval(function () { w.querySelectorAll('i').forEach(function (i) { i.style.height = (6 + Math.random() * 28) + 'px'; }); }, 140); else w.querySelectorAll('i').forEach(function (i) { i.style.height = '6px'; }); }
function chiParla(k) { [0, 1, 2].forEach(function (i) { var m = $('m' + i); if (m) m.classList.toggle('talk', i === k); }); }
function iniziaOrale(mid, q) {
  O = { mid: mid, q: q, storia: [], on: true, rec: null };
  var box = $('o-box');
  box.innerHTML = '<span class="lab">Domanda</span><div class="big" style="font-size:18px">“' + esc(q.domanda) + '”</div><div class="wave">' + '<i></i>'.repeat(9) + '</div><div class="chat" id="o-chat"></div><div id="o-stato" class="note" style="text-align:center"></div>' +
    '<button class="mic hide" id="o-mic" aria-label="Rispondi a voce"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button>' +
    '<div id="o-scrivi" class="hide"><textarea class="in" id="o-txt" rows="4" placeholder="Scrivi o detta la risposta (microfono della tastiera)"></textarea><button class="btn small" id="o-invia" style="margin-top:6px">Invia risposta</button></div>' +
    '<button class="btn ghost small" id="o-stop" style="color:var(--kob)">Interrompi</button>';
  $('o-stop').onclick = function () { fermaOrale(); vOrale(); };
  $('o-invia').onclick = function () { var t = $('o-txt').value.trim(); if (!t) return; $('o-txt').value = ''; rispostaOrale(t); };
  $('o-mic').onclick = function () { if (O && O.ascolto) { try { O.rec.stop(); } catch (e) {} } else ascolta(); };
  commissione(q.domanda, 0).then(pronto);
}
function statoO(t) { var e = $('o-stato'); if (e) e.textContent = t; }
function bolla(chi, t) { var c = $('o-chat'); if (!c) return; var b = document.createElement('div'); b.className = 'bub ' + (chi === 'studente' ? 's' : 'c'); b.textContent = t; c.appendChild(b); }
function commissione(t, chi) { if (!O || !O.on) return Promise.resolve(); if (O.storia.length) bolla('commissione', t); O.storia.push({ chi: 'commissione', testo: t }); chiParla(chi || 0); statoO('Parla la commissione…'); waveOn(true); return parla(t).then(function () { waveOn(false); chiParla(-1); }); }
function pronto() {
  if (!O || !O.on) return;
  $('o-scrivi').classList.remove('hide');
  if (SR) { $('o-mic').classList.remove('hide'); statoO('Tocca il microfono e rispondi. Toccalo di nuovo quando hai finito.'); }
  else statoO('Rispondi qui sotto: puoi usare il microfono della tastiera per dettare.');
}
function ascolta() {
  var r = new SR(), finale = ''; O.rec = r; O.ascolto = true;
  r.lang = 'it-IT'; r.continuous = true; r.interimResults = true;
  var mic = $('o-mic'); mic.classList.add('rec'); statoO('Ti ascolto… tocca di nuovo per finire.'); waveOn(true);
  r.onresult = function (e) { var temp = ''; for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finale += ' ' + e.results[i][0].transcript; else temp += e.results[i][0].transcript; } $('o-txt').value = (finale + ' ' + temp).trim(); };
  r.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') statoO('Il microfono è bloccato: consenti l\'accesso, oppure scrivi la risposta.'); };
  r.onend = function () { O.ascolto = false; mic.classList.remove('rec'); waveOn(false); var t = ($('o-txt').value || finale).trim(); if (t) { $('o-txt').value = ''; rispostaOrale(t); } else statoO('Non ho sentito nulla: riprova o scrivi la risposta.'); };
  try { r.start(); } catch (e) { O.ascolto = false; mic.classList.remove('rec'); statoO('Il riconoscimento vocale non parte: scrivi la risposta.'); }
}
function rispostaOrale(t) {
  if (!O || !O.on) return;
  bolla('studente', t); O.storia.push({ chi: 'studente', testo: t });
  $('o-mic').classList.add('hide'); $('o-scrivi').classList.add('hide'); statoO('La commissione sta valutando…');
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
function fermaOrale() { if (!O) return; O.on = false; try { if (O.rec) O.rec.abort(); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} waveOn(false); O = null; }

// ---------- RIPASSO ----------
function vRipasso() {
  var v = $('v-ripasso'), due = daRipassare(), deb = argomentiDeboli(), h = '<h2 style="font-size:25px;margin-top:4px">Ripasso</h2>';
  h += '<div class="kpis"><div class="kpi"><b>' + due.length + '</b><span>sbagliate da ripassare oggi</span></div><div class="kpi"><b>' + inArrivo() + '</b><span>tornano nei prossimi giorni</span></div></div>';
  if (due.length) h += '<button class="btn" data-rip>Ripassa ora · ' + due.length + ' domande</button>';
  h += '<div class="card"><span class="lab">Argomenti deboli</span>';
  if (!deb.length) h += '<span class="note" style="font-size:14px">Rispondi ad almeno 3 domande per argomento e qui vedrai dove sbagli di più.</span>';
  deb.slice(0, 5).forEach(function (x) { var c = S.caricamenti.find(function (k) { return k.id === x.cid; }) || {}; h += '<button class="li" data-cap="' + x.cid + ':' + x.cap + '"><span><b>' + esc(titoloCap(x.cid, x.cap)) + '</b><br><span class="note">' + esc((materia(c.materiaId) || {}).nome || '') + ' · ' + x.ko + ' errori su ' + (x.ok + x.ko) + '</span></span><span class="tag ' + (x.pct < 60 ? 'red">Ripassa' : 'grey">Quasi ok') + '</span></button>'; });
  h += '</div>';
  // collegamenti tra argomenti, materia per materia
  S.materie.forEach(function (m) {
    var nodi = [], archi = [];
    carDi(m.id).forEach(function (c) { var d = dispLocale(c.id); if (!d) return; d.argomenti.forEach(function (a, i) { var cp = d.capitoli[i]; nodi.push({ id: c.id + ':' + i, t: (cp || a).titolo, coll: cp ? cp.collegati : [] }); }); });
    if (nodi.length < 2) return;
    var norm = function (s) { return String(s).toLowerCase().replace(/[^a-zà-ù0-9 ]/g, '').trim(); };
    nodi.forEach(function (n, i) { (n.coll || []).forEach(function (t) { var j = nodi.findIndex(function (x) { return norm(x.t) === norm(t) || norm(x.t).indexOf(norm(t)) >= 0 || norm(t).indexOf(norm(x.t)) >= 0; }); if (j >= 0 && j !== i && !archi.some(function (a) { return (a[0] === i && a[1] === j) || (a[0] === j && a[1] === i); })) archi.push([i, j]); }); });
    if (!archi.length) return;
    var deboli = deb.filter(function (x) { return x.pct < 60; }).map(function (x) { return x.cid + ':' + x.cap; });
    var N = Math.min(nodi.length, 10), W = 330, H = 230, cx = W / 2, cy = H / 2, rx = 100, ry = 80;
    var pos = nodi.slice(0, N).map(function (n, i) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%"><g stroke="#9DB4D3" stroke-width="1.5">' + archi.filter(function (a) { return a[0] < N && a[1] < N; }).map(function (a) { return '<line x1="' + pos[a[0]][0] + '" y1="' + pos[a[0]][1] + '" x2="' + pos[a[1]][0] + '" y2="' + pos[a[1]][1] + '"/>'; }).join('') + '</g>' +
      nodi.slice(0, N).map(function (n, i) { var t = n.t.length > 24 ? n.t.slice(0, 23) + '…' : n.t, w = Math.max(60, t.length * 5.4 + 16), deb1 = deboli.indexOf(n.id) >= 0; return '<g font-family="Inter" font-size="10" font-weight="600" text-anchor="middle"><rect x="' + (pos[i][0] - w / 2) + '" y="' + (pos[i][1] - 12) + '" width="' + w + '" height="24" rx="12" fill="' + (deb1 ? '#ffd2cc' : '#e3f0ff') + '" stroke="' + (deb1 ? '#ff8a7e' : '#6aa5ff') + '"/><text x="' + pos[i][0] + '" y="' + (pos[i][1] + 3.5) + '" fill="#0F2350">' + esc(t) + '</text></g>'; }).join('') + '</svg>';
    h += '<div class="card"><span class="lab">Collegamenti · ' + esc(m.nome) + '</span>' + svg + '<span class="note">' + (deboli.length ? 'In rosa gli argomenti deboli: ripassarli aiuta anche quelli collegati.' : 'Gli argomenti collegati tra loro nelle tue dispense.') + '</span></div>';
  });
  var pross = prossimoPasso(due, deb);
  if (pross) h += '<button class="banner" data-pross>' + esc(pross.t) + '<span>→</span></button>';
  v.innerHTML = h;
  var r = v.querySelector('[data-rip]'); if (r) r.onclick = function () { avviaTest({ tipo: 'ripasso' }); };
  v.querySelectorAll('[data-cap]').forEach(function (b) { b.onclick = function () { var p = b.dataset.cap.split(':'); mostra('dispensa', p[0]); setTimeout(function () { var e = $('cap' + p[1]); if (e) e.scrollIntoView({ block: 'start' }); }, 60); }; });
  var p = v.querySelector('[data-pross]'); if (p) p.onclick = pross.fn;
}
function prossimoPasso(due, deb) {
  if (due.length) return { t: 'Prossimo passo: ripassa le ' + due.length + ' sbagliate', fn: function () { avviaTest({ tipo: 'ripasso' }); } };
  var w = deb.find(function (x) { return x.pct < 60; });
  if (w) { var c = S.caricamenti.find(function (k) { return k.id === w.cid; }) || {}; return { t: 'Prossimo passo: rileggi “' + titoloCap(w.cid, w.cap) + '” e rifai la verifica', fn: function () { mostra('dispensa', w.cid); } }; }
  var m = S.materie.find(function (x) { return domandeMateria(x.id).length && oraliMateria(x.id).length; });
  if (m) return { t: 'Prossimo passo: prova l\'orale di ' + m.nome, fn: function () { S.ultimaMateria = m.id; mostra('orale'); } };
  return null;
}

// ---------- IMPOSTAZIONI ----------
function vSet() {
  var v = $('v-set');
  v.innerHTML = '<button class="back" data-b>← Materie</button><h2 style="font-size:25px">Impostazioni</h2><div class="card" id="s-ai"><span class="spin"></span></div>' +
    '<div class="card"><span class="lab">Il tuo codice</span><span style="font-size:14px">Con questo codice ritrovi materie, dispense e progressi su un altro telefono.</span><b style="font-family:\'Bricolage Grotesque\';font-size:20px;letter-spacing:.02em;user-select:all">' + esc(S.uid) + '</b>' +
    '<div class="field"><label for="s-cod">Usa un altro codice</label><input id="s-cod" placeholder="u…" autocomplete="off" autocapitalize="off"></div><button class="btn ghost small" id="s-usa" style="color:var(--blu);align-self:flex-start">Passa a questo codice</button></div>' +
    '<div class="card"><span class="lab">Come lavora UniLampo</span><span style="font-size:13.5px">Dispense, fonti e domande si generano una volta per ogni caricamento e restano salvate. Ogni “Approfondisci” si genera una volta e poi si riapre gratis. Per la dispensa si usa il modello avanzato, per tutto il resto quello economico. La voce della commissione è quella del telefono, gratis.</span></div>';
  v.querySelector('[data-b]').onclick = function () { mostra('materie'); };
  $('s-usa').onclick = function () {
    var c = $('s-cod').value.trim().toLowerCase(); if (!/^u[a-z0-9]{8,30}$/.test(c)) return toast('Codice non valido.');
    api('/api/dati?uid=' + c).then(function (r) { if (!r.data) return toast('Nessun dato con questo codice.'); S = r.data; S.uid = c; try { localStorage.setItem('unilampo', JSON.stringify(S)); } catch (e) {} toast('Fatto: dati caricati'); mostra('materie'); }).catch(function () { toast('Non riesco a controllare il codice.'); });
  };
  leggiStato().then(disegnaAI);
}
function disegnaAI() {
  var b = $('s-ai'); if (!b) return;
  var R = AI.regole || {};
  b.innerHTML = '<div class="flex"><div><span class="lab">Generatore AI</span><br><b style="font-size:17px">' + (AI.accesa ? 'Acceso' : 'Spento') + '</b></div><span class="sw' + (AI.accesa ? ' on' : '') + '"></span></div>' +
    '<table class="est"><tr><td>Speso oggi</td><td>' + dollari(AI.speso) + '</td></tr><tr><td>Tetto giornaliero (nel codice)</td><td>' + dollari(AI.tetto) + '</td></tr><tr><td>Chiave Anthropic su Netlify</td><td>' + (AI.chiave ? 'presente' : 'manca') + '</td></tr><tr><td>Ricerca web</td><td>max ' + (R.MAX_FONTI_PER_ARGOMENTO || '–') + ' fonti per argomento</td></tr></table>' +
    (!AI.chiave ? '<div class="box tr"><span class="t">Manca la chiave</span>Aggiungi ANTHROPIC_API_KEY nelle variabili del progetto su Netlify.</div>' : !AI.pin ? '<div class="box tr"><span class="t">Manca il PIN</span>Aggiungi UNILAMPO_PIN nelle variabili del progetto su Netlify: senza PIN l\'AI resta spenta.</div>' :
      '<div class="field"><label for="s-pin">PIN</label><input id="s-pin" type="password" inputmode="numeric" autocomplete="off"></div><button class="btn' + (AI.accesa ? ' v' : '') + '" id="s-sw">' + (AI.accesa ? 'Spegni il generatore' : 'Accendi il generatore') + '</button>') +
    '<span class="note">Prezzi in dollari perché Anthropic fattura in dollari. Il limite mensile è quello che hai impostato nella console Anthropic.</span>';
  var sw = $('s-sw'); if (sw) sw.onclick = function () {
    sw.disabled = true;
    api('/api/interruttore', { pin: $('s-pin').value, accesa: !AI.accesa }).then(function () { return leggiStato(); }).then(function () { disegnaAI(); toast(AI.accesa ? 'Generatore acceso' : 'Generatore spento'); })
      .catch(function (e) { sw.disabled = false; toast(e && e.error === 'pin' ? 'PIN sbagliato.' : e && e.error === 'troppi' ? 'Troppi tentativi: riprova più tardi.' : 'Non riesco a cambiare lo stato.'); });
  };
}

// ---------- avvio ----------
leggiStato().then(function () { if (cur.view === 'materie') vMaterie(); });
// Al rientro nell'app ricarica in silenzio le dispense dal server (servono a test, orale e ripasso).
S.caricamenti.forEach(function (c) { if (!dispLocale(c.id)) dispCarica(c.id); });
mostra('materie');
