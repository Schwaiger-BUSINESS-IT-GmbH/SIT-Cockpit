// SIT-Cockpit – Frontend (ohne Build-Schritt, reines JavaScript)
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
  const devices = all.reduce((s, c) => s + c.deviceCount, 0);
  const online = all.reduce((s, c) => s + c.online, 0);
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
      <div class="kpi"><div class="label">Geräte online</div><div class="value">${nf(online)} <span class="muted" style="font-size:16px">/ ${nf(devices)}</span></div><div class="sub">${devices ? Math.round((online / devices) * 100) : 0} % erreichbar</div></div>
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
    `<span><b>${c.online}</b>/${c.deviceCount} online</span>`,
    c.servers ? `<span><b>${c.servers - c.serversDown}</b>/${c.servers} Server</span>` : '',
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
  const bad = c.devices.filter((x) => x.status !== 'ok');
  const good = c.devices.filter((x) => x.status === 'ok');
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
      <div class="kpi"><div class="label">Geräte online</div><div class="value">${c.online}<span class="muted" style="font-size:16px"> / ${c.deviceCount}</span></div></div>
      <div class="kpi ${c.counts.critical ? 'crit' : c.counts.warning ? 'warn' : ''}"><div class="label">Handlungsbedarf</div><div class="value">${c.counts.critical + c.counts.warning}</div><div class="sub">${c.counts.critical} kritisch · ${c.counts.warning} Warnung</div></div>
      <div class="kpi"><div class="label">Offene Tickets · weclapp</div><div class="value">${val(w.tickets, (t) => t.count)}</div></div>
      <div class="kpi"><div class="label">Managed Services / Monat</div><div class="value">${val(w.contracts, (t) => eur0(t.monthly))}</div><div class="sub">${val(w.contracts, (t) => plural(t.count, 'aktiver Vertrag', 'aktive Verträge'))}</div></div>
      <div class="kpi"><div class="label">Offene Angebote</div><div class="value">${val(w.quotations, (t) => t.count)}</div><div class="sub">${val(w.quotations, (t) => eur0(t.net) + ' netto')}</div></div>
    </section>
    <div class="card">
      <div class="card-head"><h2>Geräte</h2><span class="muted small">${plural(c.deviceCount, 'Gerät', 'Geräte')} · Probleme zuerst</span></div>
      ${!c.deviceCount ? '<p class="empty">Keine Geräte in Atera.</p>' : ''}
      ${bad.length ? `<div class="devices">${bad.map((x, i) => device(x, i === 0)).join('')}</div>` : c.deviceCount ? '<div class="banner ok" style="margin:0"><div><b>Alle Geräte in Ordnung</b></div></div>' : ''}
      ${good.length ? `<details style="margin-top:10px"><summary class="btn ghost small" style="display:inline-flex">Unauffällige Geräte anzeigen (${good.length})</summary><div class="devices" style="margin-top:8px">${good.map((x) => device(x, false)).join('')}</div></details>` : ''}
    </div>
    ${d.party ? `<div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h2>Offene Tickets</h2></div>${w.tickets?.error ? `<p class="empty">${esc(w.tickets.error)}</p>` : w.tickets?.items?.length ? `<table><tbody>${w.tickets.items.map((t) => `<tr><td class="muted" style="white-space:nowrap">${esc(t.number)}</td><td class="wrap">${esc(t.subject)}</td><td class="num muted small">${date(t.modified)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine offenen Tickets.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Offene Angebote</h2></div>${w.quotations?.error ? `<p class="empty">${esc(w.quotations.error)}</p>` : w.quotations?.items?.length ? `<table><tbody>${w.quotations.items.map((q) => `<tr><td class="muted">${esc(q.number)}</td><td>${date(q.date)}</td><td class="num">${eur(q.net)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine offenen Angebote.</p>'}</div>
    </div>` : ''}
  `;
  $('#to-offer')?.addEventListener('click', () => {
    offer.reset();
    offer.customer = { id: d.party.id, name: d.party.name, number: d.party.number };
    offer.step = 2;
    location.hash = '#/angebot';
  });
}

const KIND = { server: 'Server', workstation: 'Arbeitsplatz', other: 'Gerät' };
function device(x, open) {
  const p = x.problems[0];
  return `<details class="device" ${open ? 'open' : ''}>
    <summary>
      <span>${chip(x.status)}</span>
      <span><span class="d-name">${esc(x.name)}</span><br><span class="d-kind">${KIND[x.kind] || 'Gerät'}${x.description ? ` · ${esc(x.description)}` : ''}</span></span>
      <span class="d-problem">${p ? esc(p.text) + (x.problems.length > 1 ? ` <span class="muted">(+${x.problems.length - 1})</span>` : '') : '<span class="muted">Keine Auffälligkeiten</span>'}</span>
      <span class="d-seen">${x.online ? 'online' : `offline · ${ago(x.lastSeen)}`}</span>
    </summary>
    <div class="device-body">
      ${x.problems.length ? `<ul class="problem-list">${x.problems.map((pp) => `<li>${chip(pp.status, { offline: 'Offline', backup: 'Backup', disk: 'Speicher', alert: 'Alert' }[pp.kind] || 'Alert')} <span>${esc(pp.text)}</span>${pp.since ? `<span class="muted small">seit ${dateTime(pp.since)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      <dl class="facts">
        <div><dt>Betriebssystem</dt><dd>${esc(x.os || '–')}</dd></div>
        <div><dt>Angemeldet</dt><dd>${esc(x.user || '–')}</dd></div>
        <div><dt>IP-Adresse</dt><dd>${esc(x.ip || '–')}</dd></div>
        <div><dt>Zuletzt online</dt><dd>${x.online ? 'jetzt' : dateTime(x.lastSeen)}</dd></div>
        <div><dt>Letzter Neustart</dt><dd>${dateTime(x.lastReboot)}</dd></div>
        <div><dt>Prozessor / RAM</dt><dd>${esc(x.cpu || '–')}${x.memoryMb ? ` · ${Math.round(x.memoryMb / 1024)} GB` : ''}</dd></div>
        ${x.disks.map((dk) => `<div><dt>Laufwerk ${esc(dk.drive || '')}</dt><dd>${dk.freePct} % frei von ${nf(dk.totalGb)} GB<span class="bar ${dk.freePct < 5 ? 'crit' : dk.freePct < 10 ? 'warn' : ''}"><i style="width:${100 - dk.freePct}%"></i></span></dd></div>`).join('')}
      </dl>
      <div><a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener">In Atera öffnen / Fernwartung</a></div>
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
          <td class="wrap">${esc(o.customer.name)}<div class="muted small">${esc(o.signer.name)}</div></td>
          <td>${date(o.signedAt)}</td>
          <td class="num">${eur(o.totals.monthlyNet)}</td>
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
// Angebotsboard ("vom Bierdeckel verkaufen")
// =====================================================================
const offer = {
  step: 1, customer: null, contact: null, qty: {}, term: null, discount: 0, catalog: null, result: null,
  signer: { name: '', role: '', email: '' }, note: '', accepted: false,
  reset() { Object.assign(this, { step: 1, customer: null, contact: null, qty: {}, term: null, discount: 0, result: null, signer: { name: '', role: '', email: '' }, note: '', accepted: false }); },
};

function calc() {
  const cat = offer.catalog;
  const term = offer.term || cat.defaultTerm;
  const disc = Math.min((Number(cat.termDiscounts[term]) || 0) + (Number(offer.discount) || 0), cat.maxDiscount);
  const lines = [];
  for (const g of cat.groups) for (const it of g.items) {
    const q = Number(offer.qty[it.id]) || 0;
    if (q > 0) {
      const d = it.billing === 'monthly' ? disc : 0;
      lines.push({ ...it, quantity: q, discount: d, net: Math.round(it.price * q * (1 - d / 100) * 100) / 100 });
    }
  }
  const monthly = lines.filter((l) => l.billing === 'monthly').reduce((s, l) => s + l.net, 0);
  const once = lines.filter((l) => l.billing === 'once').reduce((s, l) => s + l.net, 0);
  const vat = cat.vatPercent / 100;
  return { lines, term, disc, monthly, once, monthlyGross: monthly * (1 + vat), onceGross: once * (1 + vat), total: monthly * term + once };
}

async function renderOffer() {
  const seq = navSeq;
  if (!offer.catalog) {
    content.innerHTML = '<p class="loading">Lade Managed-Service-Leistungen aus weclapp …</p>';
    try { offer.catalog = await api('/offer/catalog'); } catch (e) {
      if (stale(seq)) return;
      content.innerHTML = `<div class="banner crit"><div><b>Leistungen konnten nicht geladen werden</b>${esc(e.message)}</div></div>`;
      return;
    }
  }
  if (stale(seq)) return;
  if (!offer.term) offer.term = offer.catalog.defaultTerm;
  drawOffer();
}

function drawOffer() {
  const cat = offer.catalog;
  const steps = [[1, 'Kunde'], [2, 'Leistungen'], [3, 'Unterschrift']];
  const canGo = (n) => n === 1 || (n === 2 && offer.customer) || (n === 3 && offer.customer && calc().lines.length);
  const stepNav = offer.step === 4 ? '' : `<nav class="steps" aria-label="Schritte">${steps.map(([n, t]) => `<button type="button" data-step="${n}" ${offer.step === n ? 'aria-current="step"' : ''} class="${offer.step > n ? 'done' : ''}" ${canGo(n) ? '' : 'disabled'}>${n}. ${t}</button>`).join('')}</nav>`;
  const warn = !cat.categoryFound
    ? `<div class="banner warn"><div><b>Artikelkategorie „${esc(cat.category)}“ nicht in weclapp gefunden</b>Leg in weclapp die Kategorie an und ordne die Managed-Service-Artikel zu (oder setze OFFER_ARTICLE_NUMBERS).</div></div>`
    : cat.missingPrices ? `<div class="banner warn"><div><b>${plural(cat.missingPrices, 'Artikel hat', 'Artikel haben')} keinen Verkaufspreis</b>Diese Artikel werden nicht angezeigt. Bitte in weclapp einen Preis (NET1) hinterlegen.</div></div>` : '';
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Angebotsboard · Managed Services</div><h1>${offer.customer ? esc(offer.customer.name) : 'Neues Angebot'}</h1></div>
      <div class="page-actions">${offer.step !== 4 && (offer.customer || Object.keys(offer.qty).length) ? '<button class="btn ghost" id="offer-reset" type="button">Neu beginnen</button>' : ''}</div>
    </div>
    ${stepNav}${offer.step === 2 ? warn : ''}
    <div id="offer-step"></div>
  `;
  $$('[data-step]').forEach((b) => (b.onclick = () => { offer.step = Number(b.dataset.step); drawOffer(); }));
  $('#offer-reset')?.addEventListener('click', () => { if (confirm('Angebot verwerfen und neu beginnen?')) { offer.reset(); offer.term = cat.defaultTerm; drawOffer(); } });
  ({ 1: stepCustomer, 2: stepPackages, 3: stepSign, 4: stepDone })[offer.step]($('#offer-step'));
}

// Schritt 1: Kunde
function stepCustomer(el) {
  el.innerHTML = `
    <div class="card" style="max-width:720px">
      <div class="field"><label for="cust-q">Kunde suchen (Name oder Kundennummer)</label><input id="cust-q" type="search" placeholder="z. B. Gruber oder K-10004" autocomplete="off"></div>
      <div id="cust-results" class="cust-list"><p class="muted">Lade Kunden …</p></div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn primary big" id="cust-next" type="button" ${offer.customer ? '' : 'disabled'}>Weiter zu den Leistungen</button></div>
    </div>`;
  let t;
  const search = async (q) => {
    try {
      const { customers } = await api('/offer/customers?q=' + encodeURIComponent(q));
      $('#cust-results').innerHTML = customers.length
        ? customers.map((c) => `<button type="button" data-cid="${esc(c.id)}" aria-pressed="${offer.customer?.id === c.id}"><span>${esc(c.name)}</span><span class="muted">${esc(c.number || '')}</span></button>`).join('')
        : '<p class="muted">Kein Kunde gefunden. Neue Kunden bitte zuerst in weclapp anlegen.</p>';
      $$('[data-cid]').forEach((b) => (b.onclick = () => {
        const c = customers.find((x) => String(x.id) === b.dataset.cid);
        offer.customer = c;
        offer.step = 2;
        drawOffer();
      }));
    } catch (e) { $('#cust-results').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  $('#cust-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 250); };
  $('#cust-next').onclick = () => { offer.step = 2; drawOffer(); };
  $('#cust-q').focus();
  search('');
}

// Schritt 2: Leistungen
function stepPackages(el) {
  const cat = offer.catalog;
  el.innerHTML = `
    <div class="board">
      <div>${cat.groups.map((g) => `
        <section class="pkg-group"><h2>${esc(g.name)}</h2><div class="pkgs">${g.items.map((it) => {
          const q = Number(offer.qty[it.id]) || 0;
          return `<div class="pkg ${q ? 'active' : ''}" data-pkg="${esc(it.id)}">
            <div class="p-name">${esc(it.name)}</div>
            <div class="p-desc">${esc(it.description)}</div>
            <div class="p-price">${eur(it.price)} <small>/ ${esc(it.unit)}${it.billing === 'monthly' ? ' / Monat' : ' einmalig'}</small></div>
            <div class="stepper">
              <button type="button" data-dec="${esc(it.id)}" aria-label="${esc(it.name)} weniger">−</button>
              <input type="number" inputmode="numeric" min="0" step="${it.step}" value="${q}" data-qty="${esc(it.id)}" aria-label="Menge ${esc(it.name)}">
              <button type="button" data-inc="${esc(it.id)}" aria-label="${esc(it.name)} mehr">+</button>
            </div>
          </div>`;
        }).join('')}</div></section>`).join('')}
        ${!cat.groups.length ? '<div class="card empty">Keine Leistungen mit Preis gefunden.</div>' : ''}
      </div>
      <aside class="sumbox compactable" id="sumbox" aria-live="polite"></aside>
    </div>`;
  const setQty = (id, v) => {
    const it = cat.groups.flatMap((g) => g.items).find((x) => x.id === id);
    const q = Math.max(0, Math.round((Number(v) || 0) * 100) / 100);
    if (q) offer.qty[id] = q; else delete offer.qty[id];
    const box = $(`[data-pkg="${CSS.escape(id)}"]`);
    box.classList.toggle('active', q > 0);
    const inp = $(`[data-qty="${CSS.escape(id)}"]`);
    if (Number(inp.value) !== q) inp.value = q;
    void it;
    drawSum();
  };
  $$('[data-inc]').forEach((b) => (b.onclick = () => setQty(b.dataset.inc, (Number(offer.qty[b.dataset.inc]) || 0) + 1)));
  $$('[data-dec]').forEach((b) => (b.onclick = () => setQty(b.dataset.dec, (Number(offer.qty[b.dataset.dec]) || 0) - 1)));
  $$('[data-qty]').forEach((i) => { i.oninput = () => setQty(i.dataset.qty, i.value); i.onfocus = () => i.select(); });
  drawSum();
}

function drawSum() {
  const cat = offer.catalog;
  const c = calc();
  $('#sumbox').innerHTML = `
    <div class="s-main">
      <div class="s-label">Monatlich netto</div>
      <div class="s-big">${eur(c.monthly)}</div>
      <div class="s-label" style="margin-top:2px">${eur(c.monthlyGross)} brutto inkl. ${cat.vatPercent} % USt.${c.once ? `<span class="s-once"> · einmalig ${eur(c.once)}</span>` : ''}</div>
    </div>
    <div class="s-lines">${c.lines.length ? c.lines.map((l) => `<div><span>${nf(l.quantity)} × ${esc(l.name)}</span><span>${eur(l.net)}</span></div>`).join('') : '<span>Noch keine Leistung gewählt.</span>'}</div>
    <div class="s-rows">
      <div class="s-row"><span>Einmalig netto</span><b>${eur(c.once)}</b></div>
      <div class="s-row"><span>Gesamt über ${c.term} Monate</span><b>${eur0(c.total)}</b></div>
    </div>
    <div class="s-ctl">
      <div><label for="term">Laufzeit</label>
      <select id="term">${cat.terms.map((t) => `<option value="${t}" ${t === c.term ? 'selected' : ''}>${t} Monate${cat.termDiscounts[t] ? ` (−${cat.termDiscounts[t]} %)` : ''}</option>`).join('')}</select></div>
      <div><label for="disc">Zusatzrabatt monatlich (%)</label>
      <input id="disc" type="number" inputmode="decimal" min="0" max="${cat.maxDiscount}" step="0.5" value="${offer.discount || 0}"></div>
    </div>
    ${c.disc ? `<div class="s-label" style="margin-top:6px">Rabatt gesamt: ${nf(c.disc)} %</div>` : ''}
    <button class="btn primary big block s-btn" id="to-sign" type="button" ${c.lines.length ? '' : 'disabled'}>Weiter zur Unterschrift</button>
  `;
  $('#term').onchange = (e) => { offer.term = Number(e.target.value); drawSum(); };
  $('#disc').onchange = (e) => {
    const v = Math.min(Math.max(Number(e.target.value) || 0, 0), cat.maxDiscount);
    offer.discount = v;
    drawSum();
  };
  $('#to-sign').onclick = () => { offer.step = 3; drawOffer(); };
}

// Schritt 3: Zusammenfassung + Unterschrift
function stepSign(el) {
  const cat = offer.catalog;
  const c = calc();
  const monthly = c.lines.filter((l) => l.billing === 'monthly');
  const once = c.lines.filter((l) => l.billing === 'once');
  const rows = (ls) => ls.map((l) => `<tr><td class="wrap"><b>${esc(l.name)}</b><div class="muted small">${esc(l.description)}</div></td><td class="num">${nf(l.quantity)} ${esc(l.unit)}</td><td class="num">${eur(l.price)}</td><td class="num">${eur(l.net)}${l.discount ? `<div class="muted small">−${nf(l.discount)} %</div>` : ''}</td></tr>`).join('');
  el.innerHTML = `
    <div class="board">
      <div>
        <div class="card">
          <div class="card-head"><h2>Ihre Leistungen</h2><span class="muted">${esc(offer.customer.name)}</span></div>
          <div class="table-wrap"><table class="summary-table">
            <thead><tr><th>Leistung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Netto</th></tr></thead>
            <tbody>
              ${monthly.length ? `<tr><td colspan="4"><b>Monatlich</b> <span class="muted">· Laufzeit ${c.term} Monate</span></td></tr>${rows(monthly)}` : ''}
              ${once.length ? `<tr><td colspan="4"><b>Einmalig</b></td></tr>${rows(once)}` : ''}
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <h2 style="margin-bottom:12px">Beauftragung</h2>
          <div class="grid-2" style="gap:0 16px">
            <div class="field"><label for="sg-name">Name der unterschreibenden Person *</label><input id="sg-name" autocomplete="off" value="${esc(offer.signer.name)}"></div>
            <div class="field"><label for="sg-role">Funktion</label><input id="sg-role" placeholder="z. B. Geschäftsführung" value="${esc(offer.signer.role)}"></div>
          </div>
          <div class="field"><label for="sg-mail">E-Mail für die Auftragskopie</label><input id="sg-mail" type="email" inputmode="email" value="${esc(offer.signer.email)}"></div>
          <div class="field"><label for="sg-note">Vereinbarung / Notiz (erscheint im Auftrag)</label><textarea id="sg-note" placeholder="z. B. Leistungsbeginn 1. Jänner">${esc(offer.note)}</textarea></div>
          <div class="field"><label>Unterschrift *</label>
            <div class="sign-wrap"><canvas id="sign" aria-label="Unterschriftsfeld"></canvas><div class="sign-line"></div><span class="sign-hint" id="sign-hint">Hier mit dem Finger oder Stift unterschreiben</span></div>
            <div><button class="btn ghost small" id="sign-clear" type="button" style="margin-top:6px">Unterschrift löschen</button></div>
          </div>
          <label class="check"><input type="checkbox" id="sg-terms" ${offer.accepted ? 'checked' : ''}><span>Ich beauftrage die angeführten Leistungen zu den genannten Konditionen. Es gelten die <a href="${esc(cat.termsUrl)}" target="_blank" rel="noopener">AGB von ${esc(cat.companyName)}</a>.</span></label>
          <p id="sign-error" class="error" role="alert" hidden></p>
        </div>
      </div>
      <aside class="sumbox">
        <div class="s-label">Monatlich netto</div>
        <div class="s-big">${eur(c.monthly)}</div>
        <div class="s-label">${eur(c.monthlyGross)} brutto inkl. ${cat.vatPercent} % USt.</div>
        <div style="height:12px"></div>
        <div class="s-row"><span>Einmalig netto</span><b>${eur(c.once)}</b></div>
        <div class="s-row"><span>Laufzeit</span><b>${c.term} Monate</b></div>
        ${c.disc ? `<div class="s-row"><span>Rabatt</span><b>${nf(c.disc)} %</b></div>` : ''}
        <div class="s-row"><span>Gesamt über die Laufzeit</span><b>${eur0(c.total)}</b></div>
        <button class="btn primary big block" id="do-sign" type="button">Verbindlich beauftragen</button>
        <button class="btn block" id="preview" type="button" style="margin-top:8px;background:#3A3536;color:#fff">PDF-Vorschau</button>
      </aside>
    </div>`;
  const pad = signaturePad($('#sign'), () => { $('#sign-hint').hidden = true; });
  $('#sign-clear').onclick = () => { pad.clear(); $('#sign-hint').hidden = false; };
  const keep = () => {
    offer.signer = { name: $('#sg-name').value, role: $('#sg-role').value, email: $('#sg-mail').value };
    offer.note = $('#sg-note').value;
    offer.accepted = $('#sg-terms').checked;
  };
  $$('#sg-name, #sg-role, #sg-mail, #sg-note, #sg-terms').forEach((i) => (i.onchange = keep));
  const body = () => ({
    customerId: offer.customer.id,
    items: Object.entries(offer.qty).map(([articleId, quantity]) => ({ articleId, quantity })),
    termMonths: c.term,
    discountPercent: offer.discount,
    note: offer.note,
  });
  $('#preview').onclick = async () => {
    keep();
    const w = window.open('', '_blank');
    try {
      const res = await api('/offer/preview', { method: 'POST', body: body(), raw: true });
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location = url; else location.href = url;
    } catch (e) { w?.close(); toast(e.message, true); }
  };
  $('#do-sign').onclick = async () => {
    keep();
    const err = $('#sign-error');
    err.hidden = true;
    const problems = [];
    if (offer.signer.name.trim().length < 3) problems.push('Name der unterschreibenden Person fehlt');
    if (!pad.hasInk()) problems.push('Unterschrift fehlt');
    if (!offer.accepted) problems.push('Bitte die Beauftragung bestätigen (Häkchen)');
    if (problems.length) { err.textContent = problems.join(' · '); err.hidden = false; return; }
    const btn = $('#do-sign');
    btn.disabled = true;
    btn.textContent = 'Wird übertragen …';
    try {
      offer.result = await api('/offer/sign', {
        method: 'POST',
        body: { ...body(), signerName: offer.signer.name, signerRole: offer.signer.role, signerEmail: offer.signer.email, acceptedTerms: true, signature: pad.toDataURL() },
      });
      offer.step = 4;
      drawOffer();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Verbindlich beauftragen';
    }
  };
}

function signaturePad(canvas, onInk) {
  const ctx = canvas.getContext('2d');
  let ink = 0, drawing = false, last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1B2A6B'; ctx.lineWidth = 2.4;
    ink = 0;
  };
  fit();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#1B2A6B'; ctx.fill(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const pe of pts) {
      const p = pos(pe);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ink += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
    }
    if (ink > 0) onInk?.();
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = 0; },
    hasInk: () => ink > 60, // ein Punkt oder Strich reicht nicht
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}

// Schritt 4: Fertig
function stepDone(el) {
  const r = offer.result;
  const w = r.weclapp || {};
  const mail = r.signer.email || r.customer.email || '';
  const subject = `Ihr Auftrag Managed Services${w.salesOrderNumber ? ` Nr. ${w.salesOrderNumber}` : ''} – ${offer.catalog.companyName}`;
  const bodyText = `Guten Tag ${r.signer.name},\n\nvielen Dank für Ihren Auftrag. Im Anhang finden Sie die unterschriebene Auftragsübersicht.\n\nMonatlich: ${eur(r.totals.monthlyNet)} netto, Laufzeit ${r.termMonths} Monate\nEinmalig: ${eur(r.totals.onceNet)} netto\n\nMit freundlichen Grüßen\n${state.me.user.name}\n${offer.catalog.companyName}`;
  el.innerHTML = `
    <div class="card success" style="max-width:720px;margin:0 auto">
      <div class="big-check" aria-hidden="true">✓</div>
      <h1 style="margin-top:14px">Auftrag erteilt</h1>
      <p class="muted">${esc(r.customer.name)} · unterschrieben von ${esc(r.signer.name)} am ${dateTime(r.signedAt)}</p>
      <p style="font-size:18px"><b>${eur(r.totals.monthlyNet)}</b> monatlich netto${r.totals.onceNet ? ` · <b>${eur(r.totals.onceNet)}</b> einmalig` : ''}</p>
      ${w.quotationNumber ? `<div class="banner ok" style="text-align:left"><div><b>In weclapp angelegt</b>Angebot ${esc(w.quotationNumber)} (angenommen)${w.salesOrderNumber ? ` · Auftrag ${esc(w.salesOrderNumber)}` : ''} · PDF ist angehängt.</div></div>` : ''}
      ${r.warnings?.length ? `<div class="banner warn" style="text-align:left"><div><b>Bitte prüfen</b>${r.warnings.map(esc).join('<br>')}${!w.quotationNumber ? '<br>Die Unterschrift ist sicher gespeichert. Unter „Vertrieb &amp; Finanzen“ kannst du die Übertragung erneut starten.' : ''}</div></div>` : ''}
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px">
        <a class="btn primary big" href="${esc(r.pdfUrl)}" target="_blank" rel="noopener">PDF öffnen</a>
        ${mail ? `<a class="btn big" href="mailto:${esc(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}">E-Mail an Kunden</a>` : ''}
        <button class="btn ghost big" id="new-offer" type="button">Neues Angebot</button>
      </div>
      ${mail ? '<p class="hint" style="margin-top:12px">Beim E-Mail-Versand das PDF bitte anhängen (vorher über „PDF öffnen“ speichern).</p>' : ''}
    </div>`;
  $('#new-offer').onclick = () => { offer.reset(); offer.term = offer.catalog.defaultTerm; drawOffer(); };
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
