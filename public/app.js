// SIT-Cockpit – Frontend (ohne Build-Schritt, reines JavaScript)
import { renderBoard, prefillCustomer, leaveBoard } from './board.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v, digits = 2) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v || 0);
const eur0 = (v) => eur(v, 0);
const nf = (v) => new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(v || 0);
const date = (ms) => (ms ? new Date(ms).toLocaleDateString('de-AT') : '–');
const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;
const hm = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')} h`;
function ago(ms) {
  if (!ms) return 'unbekannt';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}
const STATUS_TEXT = { critical: 'Kritisch', warning: 'Warnung', ok: 'In Ordnung' };
const chip = (status, text) => `<span class="chip ${status}">${esc(text ?? STATUS_TEXT[status] ?? status)}</span>`;

const state = { me: null, overview: null, filter: 'all', query: '', timers: [] };

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Bitte neu anmelden'); }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.setAttribute('role', err ? 'alert' : 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), err ? 7000 : 3500);
}

// ---------- Anmeldung ----------
function showLogin() {
  $('#view-app').hidden = true;
  $('#view-login').hidden = false;
  $('#token').focus();
}
async function showApp() {
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#user-name').textContent = state.me.user.name;
  $('#demo-badge').hidden = !state.me.demo;
  if (!location.hash) location.hash = '#/kunden';
  route();
  refreshNavBadge();
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    await api('/login', { method: 'POST', body: { token: $('#token').value } });
    $('#token').value = '';
    state.me = await api('/me');
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});
$('#logout').addEventListener('click', async () => {
  const r = await fetch('/api/logout', { method: 'POST' }).then((x) => x.json()).catch(() => ({}));
  state.me = null;
  if (r.logoutUrl) location.href = r.logoutUrl; else showLogin();
});

// ---------- Router ----------
const content = $('#content');
let pageTimer = null;
let navSeq = 0; // jede Navigation erhöht den Zähler; veraltete Antworten zeichnen nicht mehr
const stale = (seq) => seq !== navSeq;
function route() {
  navSeq++;
  clearInterval(pageTimer);
  pageTimer = null;
  const [, page = 'kunden', id] = location.hash.split('/');
  $$('.side-nav a').forEach((a) => {
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  content.classList.toggle('flush', page === 'zeiten');
  content.classList.remove('board-host');
  if (page !== 'angebot') leaveBoard();
  const pages = { kunden: id ? () => renderCustomer(id) : renderCustomers, dashboard: renderDashboard, angebot: renderOffer, zeiten: renderTime };
  (pages[page] || renderCustomers)();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

async function refreshNavBadge() {
  try {
    const d = await api('/atera/overview');
    state.overview = d;
    const crit = d.customers.filter((c) => c.status === 'critical').length;
    const b = $('#nav-problems');
    b.hidden = !crit;
    b.textContent = crit;
    b.title = `${plural(crit, 'Kunde', 'Kunden')} mit kritischem Problem`;
  } catch { /* still */ }
}
setInterval(() => { if (state.me) refreshNavBadge(); }, 120000);

// =====================================================================
// Kunden & Geräte (Atera)
// =====================================================================
async function renderCustomers({ force = false } = {}) {
  const seq = navSeq;
  if (!state.overview || force) content.innerHTML = '<p class="loading">Lade Kundenübersicht aus Atera …</p>';
  try {
    state.overview = await api('/atera/overview' + (force ? '?refresh=1' : ''));
  } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="banner crit"><div><b>Atera nicht erreichbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  drawCustomers();
  clearInterval(pageTimer);
  pageTimer = setInterval(async () => {
    try { state.overview = await api('/atera/overview'); if (!stale(seq)) drawCustomers(true); } catch { /* nächster Versuch */ }
  }, 60000);
}

function drawCustomers(keepFocus = false) {
  const d = state.overview;
  const all = d.customers || [];
  const crit = all.filter((c) => c.status === 'critical');
  const warn = all.filter((c) => c.status === 'warning');
  const ok = all.filter((c) => c.status === 'ok');
  const srvTotal = all.reduce((s, c) => s + c.servers, 0);
  const srvUp = all.reduce((s, c) => s + c.servers - c.serversDown, 0);
  const staleTotal = all.reduce((s, c) => s + (c.staleServers || 0), 0);
  const fwTotal = all.reduce((s, c) => s + c.firewalls, 0);
  const fwDown = all.reduce((s, c) => s + c.firewallsDown, 0);
  const backups = all.reduce((s, c) => s + c.backupIssues, 0);
  const q = state.query.trim().toLowerCase();
  const match = (c) => !q || c.name.toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q);
  const f = state.filter;
  const problems = all.filter((c) => c.status !== 'ok' && (f === 'all' || f === 'problems' || c.status === f || (f === 'backup' && c.backupIssues)) && match(c));
  const fine = f === 'all' ? ok.filter(match) : [];
  const stale = d.updatedAt && Date.now() - d.updatedAt > 10 * 60000;
  const focusId = keepFocus && document.activeElement?.id;
  const selStart = document.activeElement?.selectionStart;

  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Atera · Kunden &amp; Geräte</div><h1>Kundenübersicht</h1></div>
      <div class="page-actions">
        <span class="stamp ${stale ? 'stale' : ''}">Stand: ${d.updatedAt ? ago(d.updatedAt) : '–'}</span>
        <button class="btn ghost" id="reload" type="button">Jetzt aktualisieren</button>
      </div>
    </div>
    ${d.error ? `<div class="banner ${all.length ? 'warn' : 'crit'}"><div><b>${all.length ? 'Letzte Aktualisierung fehlgeschlagen – angezeigt wird der letzte Stand' : 'Keine Daten von Atera'}</b>${esc(d.error)}</div></div>` : ''}
    <section class="kpis" aria-label="Kennzahlen">
      ${kpiBtn('critical', 'Kritisch', crit.length, 'Kunden mit akutem Problem', 'crit')}
      ${kpiBtn('warning', 'Warnung', warn.length, 'Kunden mit Hinweis', 'warn')}
      ${kpiBtn('all', 'Alles in Ordnung', ok.length, `von ${plural(all.length, 'Kunde', 'Kunden')}`)}
      <div class="kpi"><div class="label">Server online</div><div class="value">${nf(srvUp)} <span class="muted" style="font-size:16px">/ ${nf(srvTotal)}</span></div><div class="sub">${srvTotal ? Math.round((srvUp / srvTotal) * 100) : 0} % erreichbar${staleTotal ? ` · ${staleTotal} veraltet ausgeblendet` : ''}</div></div>
      <div class="kpi ${fwDown ? 'crit' : ''}"><div class="label">Firewalls nicht erreichbar</div><div class="value">${nf(fwDown)} <span class="muted" style="font-size:16px">/ ${nf(fwTotal)}</span></div><div class="sub">überwachte Firewalls</div></div>
      ${kpiBtn('backup', 'Backup-Probleme', backups, 'fehlgeschlagene Sicherungen', backups ? 'crit' : '')}
    </section>
    <div class="toolbar">
      <input id="cust-search" class="search" type="search" placeholder="Kunde oder Ort suchen …" value="${esc(state.query)}" aria-label="Kunde suchen">
      <div class="seg" role="group" aria-label="Filter">
        ${[['all', 'Alle'], ['problems', 'Nur Probleme']].map(([k, t]) => `<button type="button" data-filter="${k}" aria-pressed="${f === k || (k === 'problems' && ['critical', 'warning', 'backup'].includes(f))}">${t}</button>`).join('')}
      </div>
    </div>
    ${!all.length && !d.error ? '<div class="card empty">Atera hat keine Kunden geliefert.</div>' : ''}
    ${problems.length ? `<div class="tiles">${problems.map(tile).join('')}</div>` : ''}
    ${!problems.length && all.length && f !== 'all' ? '<div class="banner ok"><div><b>Kein Handlungsbedarf</b>Für diesen Filter gibt es gerade keine Probleme.</div></div>' : ''}
    ${!problems.length && all.length && f === 'all' && !q ? '<div class="banner ok"><div><b>Alles im grünen Bereich</b>Kein Kunde hat gerade ein Problem.</div></div>' : ''}
    ${fine.length ? `<h2 style="margin:26px 0 10px">Ohne Befund <span class="muted">(${fine.length})</span></h2><div class="tiles compact">${fine.map(tile).join('')}</div>` : ''}
    ${q && !problems.length && !fine.length ? '<p class="empty">Kein Kunde gefunden.</p>' : ''}
  `;
  $('#reload').onclick = () => renderCustomers({ force: true });
  $('#cust-search').oninput = (e) => { state.query = e.target.value; drawCustomers(true); };
  $$('[data-filter]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; drawCustomers(); }));
  if (focusId) { const el = document.getElementById(focusId); el?.focus(); if (el && selStart != null) el.setSelectionRange(selStart, selStart); }
}

function kpiBtn(filter, label, value, sub, cls = '') {
  const pressed = state.filter === filter && filter !== 'all';
  return `<button type="button" class="kpi ${cls}" data-filter="${filter}" aria-pressed="${pressed}"><div class="label">${label}</div><div class="value">${nf(value)}</div><div class="sub">${sub}</div></button>`;
}

function tile(c) {
  const meta = [
    c.servers ? `<span><b>${c.servers - c.serversDown}</b>/${c.servers} Server online</span>` : '',
    c.firewalls ? `<span>Firewall <b>${c.firewallsDown ? 'nicht erreichbar' : 'ok'}</b></span>` : '',
    c.staleServers ? `<span>${c.staleServers} veraltet</span>` : '',
    c.counts.critical ? `<span><b>${c.counts.critical}</b> kritisch</span>` : '',
    c.counts.warning ? `<span><b>${c.counts.warning}</b> Warnung</span>` : '',
  ].join('');
  return `<a class="tile ${c.status}" href="#/kunden/${encodeURIComponent(c.id)}" title="${esc(c.name)}">
    <div class="t-head"><span class="t-name">${esc(c.name)}</span>${c.status !== 'ok' ? chip(c.status, c.outage ? 'Ausfall?' : undefined) : ''}</div>
    ${c.status !== 'ok' ? `<div class="t-problem" title="${esc(c.headline)}">${esc(c.headline || '')}</div>` : ''}
    <div class="t-meta">${c.city ? `<span>${esc(c.city)}</span>` : ''}${meta}</div>
  </a>`;
}

// ---------- Kundendetail ----------
async function renderCustomer(id) {
  const seq = navSeq;
  content.innerHTML = '<p class="loading">Lade Kunde …</p>';
  let d;
  try { d = await api(`/atera/customers/${encodeURIComponent(id)}`); } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<p><a href="#/kunden">← Zur Übersicht</a></p><div class="banner crit"><div><b>Kunde konnte nicht geladen werden</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  const c = d.customer;
  const w = d.weclapp || {};
  const bad = c.devices.filter((x) => x.status !== 'ok' && !x.stale);
  const good = c.devices.filter((x) => x.status === 'ok' && !x.stale);
  const staleDevs = c.devices.filter((x) => x.stale);
  const val = (sec, f) => (sec && !sec.error ? f(sec) : '–');
  content.innerHTML = `
    <p style="margin:0 0 10px"><a href="#/kunden">← Kundenübersicht</a></p>
    <div class="page-head">
      <div>
        <div class="eyebrow">Kunde${d.party?.number ? ` · ${esc(d.party.number)}` : ''}${c.city ? ` · ${esc(c.city)}` : ''}</div>
        <h1>${esc(c.name)} ${chip(c.status)}</h1>
      </div>
      <div class="page-actions">
        <span class="stamp">Stand: ${ago(d.updatedAt)}</span>
        <a class="btn ghost" href="${esc(c.url)}" target="_blank" rel="noopener">In Atera öffnen</a>
        ${d.party ? `<button class="btn primary" id="to-offer" type="button">Angebot erstellen</button>` : ''}
      </div>
    </div>
    ${c.problems.map((p) => `<div class="banner ${p.status === 'critical' ? 'crit' : 'warn'}"><div><b>${p.kind === 'outage' ? 'Möglicher Strom- oder Internetausfall' : esc(p.text)}</b>${p.kind === 'outage' ? esc(p.text.replace(/^[^:]+:\s*/, '')) + '. Kunden anrufen und Stromversorgung bzw. Internetanschluss prüfen lassen.' : ''}</div></div>`).join('')}
    ${!d.party ? `<div class="banner info"><div><b>Kein weclapp-Kunde zugeordnet</b>Trag in Atera beim Kunden das Feld „weclapp-Kundennummer“ ein, dann erscheinen Tickets, Verträge und Angebote hier.</div></div>` : ''}
    <section class="kpis">
      <div class="kpi"><div class="label">Server online</div><div class="value">${c.servers - c.serversDown}<span class="muted" style="font-size:16px"> / ${c.servers}</span></div><div class="sub">${c.firewalls ? `Firewall: ${c.firewallsDown ? 'nicht erreichbar' : 'erreichbar'}` : 'keine Firewall überwacht'}</div></div>
      <div class="kpi ${c.counts.critical ? 'crit' : c.counts.warning ? 'warn' : ''}"><div class="label">Handlungsbedarf</div><div class="value">${c.counts.critical + c.counts.warning}</div><div class="sub">${c.counts.critical} kritisch · ${c.counts.warning} Warnung</div></div>
      <div class="kpi"><div class="label">Offene Tickets · weclapp</div><div class="value">${val(w.tickets, (t) => t.count)}</div></div>
      <div class="kpi"><div class="label">Managed Services / Monat</div><div class="value">${val(w.contracts, (t) => eur0(t.monthly))}</div><div class="sub">${val(w.contracts, (t) => plural(t.count, 'aktiver Vertrag', 'aktive Verträge'))}</div></div>
      <div class="kpi"><div class="label">Offene Angebote</div><div class="value">${val(w.quotations, (t) => t.count)}</div><div class="sub">${val(w.quotations, (t) => eur0(t.net) + ' netto')}</div></div>
    </section>
    <div class="card">
      <div class="card-head"><h2>Server &amp; Firewalls</h2><span class="muted small">${plural(c.servers, 'Server', 'Server')} · ${plural(c.firewalls, 'Firewall', 'Firewalls')} · Probleme zuerst</span></div>
      ${!c.deviceCount ? '<p class="empty">Keine Server oder Firewalls in Atera.</p>' : ''}
      ${bad.length ? `<div class="devices">${bad.map((x, i) => device(x, i === 0)).join('')}</div>` : c.deviceCount ? '<div class="banner ok" style="margin:0"><div><b>Server und Firewalls in Ordnung</b></div></div>' : ''}
      ${good.length ? `<details style="margin-top:10px"><summary class="btn ghost small" style="display:inline-flex">Unauffällige anzeigen (${good.length})</summary><div class="devices" style="margin-top:8px">${good.map((x) => device(x, false)).join('')}</div></details>` : ''}
      ${staleDevs.length ? `<details style="margin-top:10px"><summary class="btn ghost small" style="display:inline-flex">Veraltete Server (${staleDevs.length}) – lange offline, in Atera aufräumen</summary><div class="devices" style="margin-top:8px">${staleDevs.map((x) => device(x, false)).join('')}</div></details>` : ''}
    </div>
    ${d.party ? `<div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h2>Offene Tickets</h2></div>${w.tickets?.error ? `<p class="empty">${esc(w.tickets.error)}</p>` : w.tickets?.items?.length ? `<table><tbody>${w.tickets.items.map((t) => `<tr><td class="muted" style="white-space:nowrap">${esc(t.number)}</td><td class="wrap">${esc(t.subject)}</td><td class="num muted small">${date(t.modified)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine offenen Tickets.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Offene Angebote</h2></div>${w.quotations?.error ? `<p class="empty">${esc(w.quotations.error)}</p>` : w.quotations?.items?.length ? `<table><tbody>${w.quotations.items.map((q) => `<tr><td class="muted">${esc(q.number)}</td><td>${date(q.date)}</td><td class="num">${eur(q.net)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine offenen Angebote.</p>'}</div>
    </div>` : ''}
  `;
  $('#to-offer')?.addEventListener('click', () => {
    prefillCustomer(d.party);
    location.hash = '#/angebot';
  });
}

const KIND = { server: 'Server', firewall: 'Firewall', workstation: 'Arbeitsplatz', other: 'Gerät' };
const seenText = (x) => (x.online === null ? `${esc(x.monitoring || '')}-Überwachung` : x.online ? 'online' : x.kind === 'firewall' ? 'nicht erreichbar' : `offline · ${ago(x.lastSeen)}`);
function device(x, open) {
  const p = x.problems[0];
  return `<details class="device" ${open ? 'open' : ''}>
    <summary>
      <span>${x.stale ? chip('neutral', 'Veraltet') : chip(x.status)}</span>
      <span><span class="d-name">${esc(x.name)}</span><br><span class="d-kind">${KIND[x.kind] || 'Gerät'}${x.description ? ` · ${esc(x.description)}` : ''}</span></span>
      <span class="d-problem">${x.stale ? `<span class="muted">${esc(x.staleText)}</span>` : p ? esc(p.text) + (x.problems.length > 1 ? ` <span class="muted">(+${x.problems.length - 1})</span>` : '') : '<span class="muted">Keine Auffälligkeiten</span>'}</span>
      <span class="d-seen">${seenText(x)}</span>
    </summary>
    <div class="device-body">
      ${x.problems.length ? `<ul class="problem-list">${x.problems.map((pp) => `<li>${chip(pp.status, { offline: 'Offline', backup: 'Backup', disk: 'Speicher', alert: 'Alert' }[pp.kind] || 'Alert')} <span>${esc(pp.text)}</span>${pp.since ? `<span class="muted small">seit ${dateTime(pp.since)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${x.kind === 'firewall' ? `<dl class="facts">
        <div><dt>Überwachung</dt><dd>${esc(x.monitoring || '–')}</dd></div>
        <div><dt>Status</dt><dd>${x.online === null ? 'nur über Alerts (kein Online-Status)' : x.online ? 'erreichbar' : 'nicht erreichbar'}</dd></div>
        <div><dt>Details</dt><dd>${esc(x.description || '–')}</dd></div>
      </dl>
      <div><a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener">In Atera öffnen</a></div>` : `<dl class="facts">
        <div><dt>Betriebssystem</dt><dd>${esc(x.os || '–')}</dd></div>
        <div><dt>Angemeldet</dt><dd>${esc(x.user || '–')}</dd></div>
        <div><dt>IP-Adresse</dt><dd>${esc(x.ip || '–')}</dd></div>
        <div><dt>Zuletzt online</dt><dd>${x.online ? 'jetzt' : dateTime(x.lastSeen)}</dd></div>
        <div><dt>Letzter Neustart</dt><dd>${dateTime(x.lastReboot)}</dd></div>
        <div><dt>Prozessor / RAM</dt><dd>${esc(x.cpu || '–')}${x.memoryMb ? ` · ${Math.round(x.memoryMb / 1024)} GB` : ''}</dd></div>
        ${x.disks.map((dk) => `<div><dt>Laufwerk ${esc(dk.drive || '')}</dt><dd>${dk.freePct} % frei von ${nf(dk.totalGb)} GB<span class="bar ${dk.freePct < 5 ? 'crit' : dk.freePct < 10 ? 'warn' : ''}"><i style="width:${100 - dk.freePct}%"></i></span></dd></div>`).join('')}
      </dl>
      <div><a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener">In Atera öffnen / Fernwartung</a></div>`}
    </div>
  </details>`;
}

// =====================================================================
// Vertrieb & Finanzen (weclapp)
// =====================================================================
async function renderDashboard() {
  const seq = navSeq;
  content.innerHTML = '<p class="loading">Lade Zahlen aus weclapp …</p>';
  let d, hist;
  try {
    [d, hist] = await Promise.all([api('/dashboard'), api('/offer/history').catch(() => ({ offers: [] }))]);
  } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="banner crit"><div><b>weclapp nicht erreichbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  const err = (s) => s && s.error;
  const v = (s, f) => (err(s) ? '–' : f(s));
  const errSub = (s) => (err(s) ? `<div class="sub">${esc(s.error)}</div>` : '');
  const q = d.quotations, inv = d.invoices;
  const maxIntake = Array.isArray(d.intake) ? Math.max(...d.intake.map((m) => m.net), 1) : 1;
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">weclapp · Vertrieb &amp; Finanzen</div><h1>Dashboard</h1></div>
      <div class="page-actions"><span class="stamp">Stand: ${dateTime(d.generatedAt)}</span><a class="btn primary" href="#/angebot">Neues Angebot am Tablet</a></div>
    </div>
    <section class="kpis">
      <div class="kpi"><div class="label">Offene Angebote</div><div class="value">${v(q, (x) => eur0(x.net))}</div><div class="sub">${v(q, (x) => plural(x.count, 'Angebot', 'Angebote'))}</div>${errSub(q)}</div>
      <div class="kpi"><div class="label">Nachfassen (älter ${d.followUpDays} Tage)</div><div class="value">${v(q, (x) => x.followUpCount)}</div><div class="sub">${v(q, (x) => eur0(x.followUpNet) + ' netto')}</div></div>
      <div class="kpi"><div class="label">Angenommen diesen Monat</div><div class="value">${v(d.accepted, (x) => eur0(x.net))}</div><div class="sub">${v(d.accepted, (x) => plural(x.count, 'Angebot', 'Angebote'))}</div>${errSub(d.accepted)}</div>
      <div class="kpi"><div class="label">Managed Services / Monat</div><div class="value">${v(d.contracts, (x) => eur0(x.monthly))}</div><div class="sub">${v(d.contracts, (x) => plural(x.count, 'aktiver Vertrag', 'aktive Verträge'))}</div>${errSub(d.contracts)}</div>
      <div class="kpi"><div class="label">Offene Aufträge</div><div class="value">${v(d.orders, (x) => eur0(x.net))}</div><div class="sub">${v(d.orders, (x) => plural(x.count, 'Auftrag', 'Aufträge'))}</div>${errSub(d.orders)}</div>
      <div class="kpi"><div class="label">Überfällige Rechnungen</div><div class="value">${v(inv, (x) => eur0(x.overdueGross))}</div><div class="sub">${v(inv, (x) => `${plural(x.overdueCount, 'Rechnung', 'Rechnungen')} · offen gesamt ${eur0(x.openGross)}`)}</div>${errSub(inv)}</div>
      <div class="kpi"><div class="label">Offene Tickets</div><div class="value">${v(d.tickets, (x) => x.open)}</div>${errSub(d.tickets)}</div>
      <div class="kpi"><div class="label">Meine Zeit diesen Monat</div><div class="value">${v(d.myTime, (x) => hm(x.minutes))}</div><div class="sub">${v(d.myTime, (x) => `davon verrechenbar ${hm(x.billableMinutes)}`)}</div>${errSub(d.myTime)}</div>
    </section>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Auftragseingang</h2><span class="muted small">netto, letzte 6 Monate</span></div>
        ${Array.isArray(d.intake) ? `<div class="chart" role="img" aria-label="Auftragseingang der letzten 6 Monate">${d.intake.map((m, i) => `<div class="col ${i === d.intake.length - 1 ? 'current' : ''}"><span class="cv">${eur0(m.net)}</span><div class="colbar" style="height:${Math.round((m.net / maxIntake) * 120)}px" title="${esc(m.label)} ${m.year}: ${eur0(m.net)}"></div><span class="cl">${esc(m.label)}</span></div>`).join('')}</div>` : `<p class="empty">${esc(d.intake?.error || 'Keine Daten')}</p>`}
      </div>
      <div class="card">
        <div class="card-head"><h2>Am Tablet unterschrieben</h2><a href="#/angebot" class="small">Angebotsboard öffnen</a></div>
        ${hist.offers.length ? `<div class="table-wrap"><table><thead><tr><th>Kunde</th><th>Datum</th><th class="num">Monatlich</th><th>weclapp</th><th></th></tr></thead><tbody>${hist.offers.slice(0, 8).map((o) => `<tr>
          <td class="wrap">${esc(o.customer.company || o.customer.name)}<div class="muted small">${esc(o.signer.name)}</div></td>
          <td>${date(o.signedAt)}</td>
          <td class="num">${eur(o.totals.monthly ?? o.totals.monthlyNet)}</td>
          <td>${o.weclapp?.quotationNumber ? `<span class="small">Ang. ${esc(o.weclapp.quotationNumber)}${o.weclapp.salesOrderNumber ? `<br>Auftr. ${esc(o.weclapp.salesOrderNumber)}` : ''}</span>` : `<button class="btn small" data-retry="${esc(o.id)}" type="button">Erneut senden</button>`}</td>
          <td><a class="small" href="/api/offer/${encodeURIComponent(o.id)}/pdf" target="_blank" rel="noopener">PDF</a></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine Aufträge über das Angebotsboard.</p>'}
      </div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><h2>Angebote nachfassen</h2><span class="muted small">älteste zuerst</span></div>
        ${err(q) ? `<p class="empty">${esc(q.error)}</p>` : q.list.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Kunde</th><th>Alter</th><th class="num">Netto</th></tr></thead><tbody>${q.list.map((x) => `<tr><td class="muted">${esc(x.number)}</td><td class="wrap">${esc(x.customer)}</td><td>${x.ageDays >= d.followUpDays ? chip('neutral', `${x.ageDays} Tage`) : `<span class="muted">${x.ageDays} Tage</span>`}</td><td class="num">${eur(x.net)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine offenen Angebote.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h2>Überfällige Rechnungen</h2><span class="muted small">brutto</span></div>
        ${err(inv) ? `<p class="empty">${esc(inv.error)}</p>` : inv.list.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Kunde</th><th>Fällig seit</th><th class="num">Betrag</th></tr></thead><tbody>${inv.list.map((x) => `<tr><td class="muted">${esc(x.number)}</td><td class="wrap">${esc(x.customer)}</td><td>${chip('neutral', `${x.daysOverdue} Tage`)}</td><td class="num">${eur(x.gross)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine überfälligen Rechnungen.</p>'}
      </div>
    </div>
  `;
  $$('[data-retry]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/offer/${encodeURIComponent(b.dataset.retry)}/retry`, { method: 'POST' }); toast(r.weclapp?.quotationNumber ? `In weclapp angelegt: Angebot ${r.weclapp.quotationNumber}` : 'weclapp hat wieder nicht angenommen'); renderDashboard(); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

// =====================================================================
// Angebotsboard (eigenes Modul, Gestaltung nach SIT_Angebotsboard_V4)
// =====================================================================
function renderOffer() {
  content.classList.add('board-host');
  renderBoard(content, { api, toast, me: state.me });
}

// =====================================================================
// Zeiten (SIT-Time eingebettet)
// =====================================================================
function renderTime() {
  content.innerHTML = '<iframe class="time-frame" src="/zeiten/" title="SIT-Time Zeiterfassung"></iframe>';
}

// ---------- Start ----------
(async () => {
  try {
    state.me = await api('/me');
    showApp();
  } catch {
    try { const h = await fetch('/healthz').then((r) => r.json()); $('#login-demo').hidden = !h.demo; } catch { /* egal */ }
    showLogin();
  }
})();
