/* UniLampo · pannello del titolare */
'use strict';
var $ = function (id) { return document.getElementById(id); };
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function dollari(x) { x = Number(x) || 0; if (x > 0 && x < 0.001) return 'meno di $0,001'; return '$' + (x < 0.1 ? x.toFixed(3) : x.toFixed(2)).replace('.', ','); }
function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('on'); }, 2600); }
var PIN = ''; try { PIN = sessionStorage.getItem('ul-pin') || ''; } catch (e) {}
function chiama(extra) {
  return fetch('/api/pannello', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ pin: PIN, azione: 'stato' }, extra || {})) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { j.status = r.status; throw j; } return j; }); });
}
function accesso(msg) {
  $('v').innerHTML = '<div class="card" style="margin-top:30px"><span class="lab">Pannello di UniLampo</span><h2 style="font-size:24px">Inserisci il PIN</h2>' +
    (msg ? '<div class="box tr"><span class="t">Attenzione</span>' + esc(msg) + '</div>' : '') +
    '<div class="field"><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password"></div><button class="btn" id="entra">Entra</button><span class="note">Dopo 8 tentativi sbagliati si blocca per un po\'.</span></div>';
  var i = $('pin'); i.focus();
  var vai = function () { PIN = i.value.trim(); if (!PIN) return; carica(); };
  $('entra').onclick = vai; i.onkeydown = function (e) { if (e.key === 'Enter') vai(); };
}
function errore(e) {
  if (e && e.error === 'pin') return 'PIN sbagliato.';
  if (e && e.error === 'troppi') return 'Troppi tentativi sbagliati: riprova più tardi.';
  if (e && e.error === 'nopin') return 'Su Netlify manca la variabile UNILAMPO_PIN.';
  return 'Il pannello non risponde: controlla la connessione.';
}
function carica(extra) {
  return chiama(extra).then(function (d) { try { sessionStorage.setItem('ul-pin', PIN); } catch (e) {} disegna(d); return d; })
    .catch(function (e) { if (e && (e.error === 'pin' || e.error === 'troppi' || e.error === 'nopin')) { try { sessionStorage.removeItem('ul-pin'); } catch (x) {} PIN = ''; accesso(errore(e)); } else if (e && e.error === 'nochiave') toast('Manca la chiave Anthropic su Netlify.'); else if (e && e.error === 'maxextra') toast('Oggi il tetto è già al massimo.'); else toast(errore(e)); });
}
var GRUPPI = [
  { nome: 'Dispense e mappe', nota: 'modello avanzato', voci: ['capitolo', 'mappa'] },
  { nome: 'Ricerca fonti', nota: 'modello economico + ricerca web', voci: ['ricerca'] },
  { nome: 'Argomenti, domande, approfondimenti, orale', nota: 'modello economico', voci: ['argomenti', 'domande', 'approfondisci', 'orale'] },
];
function quando(ms) {
  if (!ms) return '–';
  var d = new Date(ms), oggi = new Date(), ieri = new Date(Date.now() - 864e5);
  if (d.toDateString() === oggi.toDateString()) return 'oggi ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === ieri.toDateString()) return 'ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
function disegna(d) {
  var o = d.oggi || { usd: 0, voci: {} }, pct = Math.min(100, Math.round((o.usd / d.tetto) * 100)), h = '';
  h += '<div class="card"><div class="flex"><div><span class="lab">Generatore AI</span><br><b style="font-size:19px">' + (d.accesa ? 'Acceso' : 'Spento') + '</b></div><span class="sw' + (d.accesa ? ' on' : '') + '"></span></div>' +
    '<button class="btn' + (d.accesa ? ' v' : '') + '" id="sw">' + (d.accesa ? 'Spegni il generatore' : 'Accendi il generatore') + '</button>' +
    '<span class="note">Spento: chi usa l\'app vede “in pausa”, ma dispense già pronte, test e ripasso funzionano.</span>' +
    '<div class="flex" style="margin-top:6px"><span class="lab">Oggi</span><b>' + dollari(o.usd) + ' di ' + dollari(d.tetto) + '</b></div><div class="bar"><i class="' + (pct >= 80 ? 'low' : '') + '" style="width:' + pct + '%"></i></div>' +
    (pct >= 80 ? '<div class="box tr"><span class="t">Tetto quasi raggiunto</span>Arrivati al tetto la preparazione delle dispense si ferma fino a domani.</div>' : '') +
    (d.tetto < d.tettoBase + d.extraMax ? '<button class="btn ghost small" id="piu" style="color:var(--blu)">Alza il tetto di 1 dollaro, solo per oggi</button>' : '<span class="note">Tetto di oggi già alzato al massimo.</span>') +
    (d.tetto > d.tettoBase ? '<span class="note">Tetto normale ' + dollari(d.tettoBase) + ', oggi alzato a ' + dollari(d.tetto) + '. Domani torna normale.</span>' : '') + '<table class="est">';
  GRUPPI.forEach(function (g) {
    var usd = 0, ch = 0, ric = 0;
    g.voci.forEach(function (v) { var x = o.voci[v]; if (x) { usd += x.usd; ch += x.chiamate; ric += x.ricerche || 0; } });
    h += '<tr><td>' + g.nome + '<br><span class="note">' + g.nota + ' · ' + ch + (ch === 1 ? ' chiamata' : ' chiamate') + (ric ? ' · ' + ric + (ric === 1 ? ' ricerca web' : ' ricerche web') : '') + '</span></td><td>' + dollari(usd) + '</td></tr>';
  });
  h += '</table></div>';
  var max = Math.max.apply(null, d.giorni.map(function (g) { return g.usd; }).concat([0.01])), tot = d.giorni.reduce(function (a, g) { return a + g.usd; }, 0);
  h += '<div class="card"><span class="lab">Ultimi 7 giorni</span><div class="chart">' + d.giorni.map(function (g, i) {
    var gg = new Date(g.giorno + 'T12:00:00');
    return '<div class="' + (i === d.giorni.length - 1 ? 'oggi' : '') + '" title="' + dollari(g.usd) + '"><span>' + (g.usd ? dollari(g.usd) : '') + '</span><i style="height:' + Math.round((g.usd / max) * 70) + 'px"></i>' + gg.toLocaleDateString('it-IT', { weekday: 'short' }) + '</div>';
  }).join('') + '</div><span class="note">Totale settimana ' + dollari(tot) + '. Il limite mensile è quello impostato nella console Anthropic.</span></div>';
  h += '<div class="card"><span class="lab">Tester · ' + d.tester.length + '</span>';
  if (!d.tester.length) h += '<span class="note" style="font-size:14px">Ancora nessuno ha usato l\'app.</span>';
  d.tester.forEach(function (t) {
    var attiva = t.agg && Date.now() - t.agg < 3 * 864e5;
    h += '<div class="li"><span><b>' + esc(t.codice) + '</b><br><span class="note">' + t.materie + (t.materie === 1 ? ' materia' : ' materie') + ' · ' + t.dispense + (t.dispense === 1 ? ' dispensa' : ' dispense') + ' · ' + t.risposte + ' risposte · ' + t.orali + (t.orali === 1 ? ' orale · ' : ' orali · ') + quando(t.agg) + '</span></span><span class="tag' + (attiva ? '' : ' grey') + '">' + (attiva ? 'attiva' : 'ferma') + '</span></div>';
  });
  h += '<span class="note">Vedi solo i numeri, mai gli appunti o le dispense.</span></div>';
  var R = d.regole, pe = R.PREZZI[R.ECONOMICO], pc = R.PREZZI[R.COSTOSO];
  if (d.ultimoErrore) h += '<div class="box tr"><span class="t">Ultimo errore · ' + esc(quando(Date.parse(d.ultimoErrore.quando))) + '</span><b>' + esc(d.ultimoErrore.motivo) + '</b> (codice ' + esc(d.ultimoErrore.status) + ', passo ' + esc(d.ultimoErrore.passo) + ')<br><span class="note">' + esc(d.ultimoErrore.dettaglio) + '</span></div>';
  h += '<div class="card"><span class="lab">Chiave e regole di costo</span><div class="li"><span>Chiave Anthropic su Netlify</span><span class="tag' + (d.chiave ? '' : ' red') + '">' + (d.chiave ? 'presente' : 'manca') + '</span></div>' +
    '<table class="est"><tr><td>Tetto giornaliero (nel codice)</td><td>' + dollari(d.tetto) + '</td></tr>' +
    '<tr><td>Modello economico<br><span class="note">' + esc(R.ECONOMICO) + ' · per milione di token</span></td><td>' + dollari(pe.in) + ' in · ' + dollari(pe.out) + ' out</td></tr>' +
    '<tr><td>Modello avanzato (solo dispense)<br><span class="note">' + esc(R.COSTOSO) + ' · per milione di token</span></td><td>' + dollari(pc.in) + ' in · ' + dollari(pc.out) + ' out</td></tr>' +
    '<tr><td>Ricerca web</td><td>' + dollari(R.PREZZO_RICERCA) + ' a ricerca</td></tr>' +
    '<tr><td>Per ogni argomento</td><td>max ' + R.RICERCHE_PER_ARGOMENTO + ' ricerche, ' + R.MAX_FONTI_PER_ARGOMENTO + ' fonti</td></tr></table>' +
    '<span class="note">Ogni dispensa, ricerca e approfondimento si genera una volta e poi si riusa gratis. Prezzi in dollari: Anthropic fattura in dollari.</span></div>';
  h += '<div class="row"><button class="btn ghost small" id="agg" style="color:var(--blu)">Aggiorna</button><button class="btn ghost small" id="esci" style="color:var(--kob)">Esci</button></div>';
  $('v').innerHTML = h;
  $('sw').onclick = function () { this.disabled = true; carica({ azione: 'interruttore', accesa: !d.accesa }).then(function (x) { if (x) toast(x.accesa ? 'Generatore acceso' : 'Generatore spento'); }); };
  $('agg').onclick = function () { carica(); };
  var piu = $('piu'); if (piu) piu.onclick = function () { piu.disabled = true; carica({ azione: 'tetto+' }).then(function (x) { if (x) toast('Tetto di oggi: ' + dollari(x.tetto)); }); };
  $('esci').onclick = function () { try { sessionStorage.removeItem('ul-pin'); } catch (e) {} PIN = ''; accesso(); };
}
if (PIN) carica(); else accesso();
