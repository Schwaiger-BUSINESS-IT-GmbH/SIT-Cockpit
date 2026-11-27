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
  $('#nav-finance').hidden = !state.me.roles?.finance;
  if (!location.hash) location.hash = '#/start';
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
  const [, page = 'start', id] = location.hash.split('/');
  $$('.side-nav a').forEach((a) => {
    if (a.dataset.nav === page || (page === 'zuordnung' && a.dataset.nav === 'kunden') || (page === 'dashboard' && a.dataset.nav === 'vertrieb')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  content.classList.toggle('flush', page === 'zeiten');
  content.classList.remove('board-host');
  if (page !== 'angebot') leaveBoard();
  const pages = { start: renderStart, kunden: id ? () => renderCustomer(id) : renderCustomers, zuordnung: renderCustomerMap, vertrieb: renderDashboard, dashboard: renderDashboard, finanzen: id === 'vertraege' ? renderContracts : renderFinance, security: renderSecurity, backups: renderBackups, angebot: renderOffer, zeiten: renderTime };
  (pages[page] || renderStart)();
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
// Startseite
// =====================================================================
const ICON = {
  finanzen: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
  kunden: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  vertrieb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  angebot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 17c1.5-2 3-2 4 0s2.5 1 4-1"/></svg>',
  zeiten: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  security: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M12 8v5M12 16h.01"/></svg>',
};

async function renderStart() {
  const seq = navSeq;
  const name = (state.me?.user?.name || '').split(' ')[0];
  const h = new Date().getHours();
  const hello = h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  content.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">${new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div><h1>${hello}${name ? `, ${esc(name)}` : ''}</h1></div>
      <div class="page-actions"><a class="btn primary" href="#/angebot">Neues Angebot</a><a class="btn ghost" href="#/zeiten">Zeiterfassung</a></div></div>
    <section class="home-areas" id="home-areas">${['kunden', 'security', 'vertrieb', 'angebot', 'zeiten'].map((k) => `<div class="area-card loading-card" data-area="${k}"><div class="area-head">${ICON[k]}<span>Lade …</span></div></div>`).join('')}</section>
    <div class="grid-2" style="margin-top:18px">
      <section class="card"><div class="card-head"><h2>Braucht Aufmerksamkeit</h2><span class="muted small" id="att-count"></span></div><div id="attention"><p class="loading" style="padding:8px 0">Sammle offene Punkte …</p></div></section>
      <section class="card"><div class="card-head"><h2>Schnellzugriff</h2></div><div class="quick" id="quick"></div></section>
    </div>`;
  // Alles parallel laden; jeder Bereich zeichnet sich, sobald seine Daten da sind
  const fin = state.me?.roles?.finance;
  const [ov, dash, hist, drafts, timers, cmap, finR, secR, bkR] = await Promise.allSettled([
    api('/atera/overview'), api('/dashboard'), api('/offer/history'), api('/offer/drafts'), timeFetch('/timers'), api('/customer-map'),
    fin ? api('/finance') : Promise.resolve(null), api('/security/summary'), api('/backups'),
  ]);
  if (stale(seq)) return;
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const o = val(ov), d = val(dash), hi = val(hist)?.offers || [], dr = val(drafts)?.drafts || [], ti = val(timers), cm = val(cmap), f = val(finR), sec = val(secR), bk = val(bkR);

  // --- Bereichskarten
  const card = (k, href, title, big, bigLabel, lines, cls = '') => `<a class="area-card ${cls}" href="${href}" data-area="${k}">
      <div class="area-head">${ICON[k]}<span>${title}</span><span class="area-go" aria-hidden="true">→</span></div>
      <div class="area-big">${big}</div><div class="area-label">${bigLabel}</div>
      <ul class="area-lines">${lines.filter(Boolean).map((l) => `<li>${l}</li>`).join('')}</ul></a>`;
  const cust = o?.customers || [];
  const crit = cust.filter((c) => c.status === 'critical'), warn = cust.filter((c) => c.status === 'warning');
  const srvDown = cust.reduce((s, c) => s + c.serversDown, 0), fwDown = cust.reduce((s, c) => s + (c.firewallsDown || 0), 0);
  const areas = [
    o ? card('kunden', '#/kunden', 'Kunden &amp; Geräte', crit.length, crit.length === 1 ? 'Kunde kritisch' : 'Kunden kritisch',
      [`${warn.length} mit Warnung · ${cust.length - crit.length - warn.length} ohne Befund`, srvDown || fwDown ? `${plural(srvDown, 'Server', 'Server')} offline · ${plural(fwDown, 'Firewall', 'Firewalls')} nicht erreichbar` : 'Alle Server und Firewalls erreichbar', `Stand ${ago(o.updatedAt)}`],
      crit.length ? 'crit' : warn.length ? 'warn' : 'ok')
      : card('kunden', '#/kunden', 'Kunden &amp; Geräte', '–', 'Atera nicht erreichbar', [esc(ov.reason?.message || '')]),
    sec ? card('security', '#/security', 'Security', sec.exploited, sec.exploited === 1 ? 'aktiv ausgenutzte Lücke offen' : 'aktiv ausgenutzte Lücken offen',
      [`${plural(sec.critical, 'kritische Meldung', 'kritische Meldungen')} offen (30 Tage)`, ...sec.top.slice(0, 2).map((t) => `${esc(t.vendor)}: ${esc(t.title)}`)],
      sec.exploited ? 'crit' : sec.critical ? 'warn' : 'ok')
      : card('security', '#/security', 'Security', '–', 'Meldungen werden geladen', ['Hersteller-Feeds werden im Hintergrund abgerufen']),
    d ? card('vertrieb', '#/vertrieb', 'Vertrieb', d.quotations?.error ? '–' : eur0(d.quotations.net), d.quotations?.error ? 'Angebote: keine Berechtigung' : `in ${plural(d.quotations.count, 'offenem Angebot', 'offenen Angeboten')}`,
      [!d.quotations?.error && d.quotations.followUpCount ? `${d.quotations.followUpCount} zum Nachfassen` : null, d.accepted?.error ? null : `${eur0(d.accepted.net)} diesen Monat angenommen`, d.contracts?.error ? null : `${eur0(d.contracts.monthly)} Managed Services / Monat`])
      : card('vertrieb', '#/vertrieb', 'Vertrieb', '–', 'weclapp nicht erreichbar', []),
    ...(fin ? [f ? card('finanzen', '#/finanzen', 'Finanzen', f.bank?.error ? '–' : eur0(f.bank.balance), f.bank?.error ? 'Kontostand nicht verfügbar' : 'Kontostand gesamt',
      [f.receivables?.error ? null : `${eur0(f.receivables.overdue)} Forderungen überfällig`, f.payables?.error ? null : `${eur0(f.payables.due7)} Eingangsrechnungen in 7 Tagen fällig`, f.revenue?.error ? null : `${eur0(f.revenue.ytd)} Umsatz seit Jahresbeginn`])
      : card('finanzen', '#/finanzen', 'Finanzen', '–', 'Finanzdaten nicht verfügbar', [])] : []),
    card('angebot', '#/angebot', 'Angebotsboard', plural(hi.filter((x) => new Date(x.signedAt).getMonth() === new Date().getMonth() && new Date(x.signedAt).getFullYear() === new Date().getFullYear()).length, 'Auftrag', 'Aufträge'), 'diesen Monat unterschrieben',
      [hi[0] ? `Zuletzt: ${esc(hi[0].customer.company || hi[0].customer.name || '')} (${date(hi[0].signedAt)})` : 'Noch kein Auftrag über das Board', dr.length ? `${plural(dr.length, 'gespeicherter Kundenstand', 'gespeicherte Kundenstände')}` : null]),
    (() => {
      if (!ti) return card('zeiten', '#/zeiten', 'Zeiten', '–', 'SIT-Time öffnen', ['Timer und Buchungen in SIT-Time']);
      const run = (ti.timers || []).find((t) => t.running);
      const today = (ti.history || []).filter((x) => new Date(x.bookedAt).toDateString() === new Date().toDateString());
      const mins = today.reduce((s, x) => s + (Number(x.minutes) || 0), 0);
      return card('zeiten', '#/zeiten', 'Zeiten', hm(mins), 'heute gebucht', [run ? `Läuft: ${esc(run.ticket.number)} ${esc(run.ticket.subject || '')}` : 'Kein Timer läuft', (ti.timers || []).length ? plural(ti.timers.length, 'offener Timer', 'offene Timer') : null], run ? 'run' : '');
    })(),
  ];
  $('#home-areas').innerHTML = areas.join('');
  const nbs = $('#nav-security');
  if (nbs && sec) { nbs.hidden = !sec.exploited; nbs.textContent = sec.exploited; }

  // --- Braucht Aufmerksamkeit
  const items = [];
  for (const c of crit.slice(0, 6)) items.push({ sev: 'critical', tag: 'Kunde', text: `${c.name}: ${c.headline || 'kritisch'}`, href: `#/kunden/${encodeURIComponent(c.id)}` });
  for (const t of (sec?.top || []).filter((x) => x.exploited)) items.push({ sev: 'critical', tag: 'Security', text: `${t.vendor}: ${t.title} – aktiv ausgenutzt${t.customers ? `, ${plural(t.customers, 'Kunde', 'Kunden')} betroffen` : ''}`, href: '#/security' });
  const bkFailed = bk && bk.totals.lastNightFailed ? bk.customers.filter((c) => c.cells.find((x) => x.day === bk.totals.lastNight)?.status === 'failed') : [];
  for (const c of bkFailed.slice(0, 4)) items.push({ sev: 'critical', tag: 'Backup', text: `${c.name}: Sicherung letzte Nacht fehlgeschlagen`, href: '#/backups' });
  const nbb = $('#nav-backups');
  if (nbb && bk) { nbb.hidden = !bkFailed.length; nbb.textContent = bkFailed.length || ''; }
  for (const x of hi.filter((x) => !x.weclapp?.quotationNumber).slice(0, 3)) items.push({ sev: 'neutral', tag: 'Auftrag', text: `${x.customer.company || x.customer.name}: unterschrieben, aber noch nicht in weclapp`, href: '#/vertrieb' });
  if (f && !f.receivables?.error) for (const i of f.receivables.list.slice(0, 3)) items.push({ sev: 'neutral', tag: 'Rechnung', text: `${i.number} ${i.customer}: ${eur(i.amount)} seit ${i.days} Tagen fällig`, href: '#/finanzen' });
  if (d && !d.quotations?.error) for (const q of d.quotations.list.filter((q) => q.ageDays >= d.followUpDays).slice(0, 3)) items.push({ sev: 'neutral', tag: 'Angebot', text: `${q.number} ${q.customer}: ${eur(q.net)}, ${q.ageDays} Tage offen`, href: '#/vertrieb' });
  for (const c of warn.slice(0, Math.max(0, 8 - items.length))) items.push({ sev: 'warning', tag: 'Kunde', text: `${c.name}: ${c.headline || 'Warnung'}`, href: `#/kunden/${encodeURIComponent(c.id)}` });
  $('#att-count').textContent = items.length ? plural(items.length, 'Punkt', 'Punkte') : '';
  $('#attention').innerHTML = items.length
    ? `<ul class="att-list">${items.map((x) => `<li><a href="${x.href}">${chip(x.sev, x.tag)}<span>${esc(x.text)}</span></a></li>`).join('')}</ul>`
    : '<div class="banner ok" style="margin:0"><div><b>Alles erledigt</b>Gerade gibt es nichts, das sofort Aufmerksamkeit braucht.</div></div>';

  // --- Schnellzugriff
  const openMap = cm ? cm.customers.filter((c) => !c.current?.id).length : null;
  const quick = [
    ['#/angebot', 'Neues Angebot', 'Am Tablet beim Kunden kalkulieren und unterschreiben'],
    ['#/kunden', 'Kundenübersicht', 'Server und Firewalls aller Kunden'],
    ['#/security', 'Security', 'Sicherheitsmeldungen von Fortinet, Microsoft, Synology & Co.'],
    ['#/zeiten', 'Zeit erfassen', 'Timer auf ein weclapp-Ticket starten'],
    ['#/vertrieb', 'Vertrieb', 'Angebote, Pipeline, Auftragseingang'],
    ...(fin ? [['#/finanzen', 'Finanzen', 'Liquidität, Forderungen, Umsatz – nur Geschäftsführung/Buchhaltung']] : []),
    ['#/zuordnung', 'Kundenzuordnung', openMap ? `${plural(openMap, 'Kunde', 'Kunden')} noch ohne weclapp-Verknüpfung` : 'Atera-Kunden mit weclapp verknüpfen'],
  ];
  $('#quick').innerHTML = quick.map(([href, t, sub]) => `<a class="quick-item" href="${href}"><b>${esc(t)}</b><span>${esc(sub)}</span></a>`).join('');
}

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
        <a class="btn ghost" href="#/zuordnung">Kundenzuordnung weclapp</a>
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
    ${(d.pauses || []).length ? `<div class="card" style="margin-top:26px"><div class="card-head"><h2>Pausierte Meldungen <span class="muted">(${d.pauses.length})</span></h2><span class="muted small">zählen nicht als kritisch oder Warnung</span></div>
      <div class="table-wrap"><table><tbody>${[...d.pauses].sort((a, b) => a.customerName.localeCompare(b.customerName, 'de')).map((p) => `<tr><td><a href="#/kunden/${encodeURIComponent(p.customerId)}">${esc(p.customerName)}</a>${p.type === 'device' ? ` · ${esc(p.name)}` : ' <span class="muted small">(ganzer Kunde)</span>'}</td><td>${esc(pauseUntil(p))}</td><td class="wrap muted">${esc(p.reason || '')}</td><td class="muted small">${esc(p.by)}, ${date(p.at)}</td><td class="num"><button class="btn small" type="button" data-unpause="${esc(p.key)}" data-name="${esc(p.type === 'device' ? p.name : p.customerName)}">Beenden</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}
  `;
  $('#reload').onclick = () => renderCustomers({ force: true });
  $$('[data-unpause]').forEach((b) => (b.onclick = () => endPause(b.dataset.unpause, b.dataset.name, () => renderCustomers())));
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
    !c.paused && c.pausedDevices ? `<span>${c.pausedDevices} pausiert</span>` : '',
  ].join('');
  return `<a class="tile ${c.status}" href="#/kunden/${encodeURIComponent(c.id)}" title="${esc(c.name)}">
    <div class="t-head"><span class="t-name">${esc(c.name)}</span>${c.paused ? chip('neutral', 'Pausiert') : c.status !== 'ok' ? chip(c.status, c.outage ? 'Ausfall?' : undefined) : ''}</div>
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
  curDetail = d;
  const w = d.weclapp || {};
  const bad = c.devices.filter((x) => x.status !== 'ok' && !x.stale);
  const pausedDevs = c.devices.filter((x) => x.paused && x.pausedStatus !== 'ok' && !x.stale);
  const good = c.devices.filter((x) => x.status === 'ok' && !x.stale && !pausedDevs.includes(x));
  const staleDevs = c.devices.filter((x) => x.stale);
  const val = (sec, f) => (sec && !sec.error ? f(sec) : '–');
  content.innerHTML = `
    <p style="margin:0 0 10px"><a href="#/kunden">← Kundenübersicht</a></p>
    <div class="page-head">
      <div>
        <div class="eyebrow">Kunde${d.party?.number ? ` · ${esc(d.party.number)}` : ''}${c.city ? ` · ${esc(c.city)}` : ''}</div>
        <h1>${esc(c.name)} ${c.paused ? chip('neutral', 'Pausiert') : chip(c.status)}</h1>
      </div>
      <div class="page-actions">
        <span class="stamp">Stand: ${ago(d.updatedAt)}</span>
        <a class="btn ghost" href="${esc(c.url)}" target="_blank" rel="noopener">In Atera öffnen</a>
        ${c.paused ? '' : '<button class="btn ghost" type="button" data-pause-customer>Kunde pausieren</button>'}
        ${d.party ? '<button class="btn ghost" type="button" data-ticket-general>Ticket erstellen</button>' : ''}
        ${d.party ? `<button class="btn primary" id="to-offer" type="button">Angebot erstellen</button>` : ''}
      </div>
    </div>
    ${c.paused ? `<div class="banner info" style="justify-content:space-between;flex-wrap:wrap"><div><b>Meldungen pausiert</b>${esc(pauseText(c.paused))}${c.pausedStatus !== 'ok' ? ` · eigentlicher Zustand: ${c.pausedStatus === 'critical' ? 'kritisch' : 'Warnung'}` : ''}</div><button class="btn small" type="button" data-unpause="${esc(c.paused.key)}" data-name="${esc(c.name)}">Pause beenden</button></div>` : ''}
    ${c.problems.map((p, i) => `<div class="banner ${p.status === 'critical' ? 'crit' : 'warn'}" style="justify-content:space-between;flex-wrap:wrap"><div><b>${p.kind === 'outage' ? 'Möglicher Strom- oder Internetausfall' : esc(p.text)}</b>${p.kind === 'outage' ? esc(p.text.replace(/^[^:]+:\s*/, '')) + '. Kunden anrufen und Stromversorgung bzw. Internetanschluss prüfen lassen.' : ''}</div>${ticketBtn(null, p, i)}</div>`).join('')}
    ${!d.party ? `<div class="banner info"><div><b>Kein weclapp-Kunde zugeordnet</b>Unter <a href="#/zuordnung">Kundenzuordnung</a> verknüpfen (oder in Atera das Feld „weclapp-Kundennummer“ befüllen), dann erscheinen Tickets, Verträge und Angebote hier und es lassen sich Tickets anlegen.</div></div>` : ''}
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
      ${bad.length ? `<div class="devices">${bad.map((x, i) => device(x, i === 0)).join('')}</div>` : c.deviceCount ? `<div class="banner ok" style="margin:0"><div><b>${pausedDevs.length ? 'Keine aktiven Probleme' : 'Server und Firewalls in Ordnung'}</b>${pausedDevs.length ? 'Pausierte Meldungen siehe unten.' : ''}</div></div>` : ''}
      ${pausedDevs.length ? `<h3 class="muted" style="margin:16px 0 8px;font-size:14px">Pausiert (${pausedDevs.length})</h3><div class="devices">${pausedDevs.map((x) => device(x, false)).join('')}</div>` : ''}
      ${good.length ? `<details style="margin-top:10px"><summary class="btn ghost small" style="display:inline-flex">Unauffällige anzeigen (${good.length})</summary><div class="devices" style="margin-top:8px">${good.map((x) => device(x, false)).join('')}</div></details>` : ''}
      ${staleDevs.length ? `<details style="margin-top:10px"><summary class="btn ghost small" style="display:inline-flex">Veraltete Server (${staleDevs.length}) – lange offline, in Atera aufräumen</summary><div class="devices" style="margin-top:8px">${staleDevs.map((x) => device(x, false)).join('')}</div></details>` : ''}
    </div>
    ${d.party ? `<div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h2>Offene Tickets</h2></div>${w.tickets?.error ? `<p class="empty">${esc(w.tickets.error)}</p>` : w.tickets?.items?.length ? `<table><tbody>${w.tickets.items.map((t) => `<tr><td class="muted" style="white-space:nowrap">${esc(t.number)}</td><td class="wrap">${esc(t.subject)}</td><td class="num muted small">${date(t.modified)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine offenen Tickets.</p>'}</div>
      <div class="card"><div class="card-head"><h2>Offene Angebote</h2></div>${w.quotations?.error ? `<p class="empty">${esc(w.quotations.error)}</p>` : w.quotations?.items?.length ? `<table><tbody>${w.quotations.items.map((q) => `<tr><td class="muted">${esc(q.number)}</td><td>${date(q.date)}</td><td class="num">${eur(q.net)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine offenen Angebote.</p>'}</div>
    </div>` : ''}
  `;
  $$('[data-ticket]').forEach((b) => (b.onclick = () => {
    const [guid, idx] = b.dataset.ticket.split('|');
    const dev = guid === 'kunde' ? null : c.devices.find((x) => x.guid === guid);
    const prob = dev ? dev.problems[Number(idx)] : c.problems[Number(idx)];
    openTicketDialog(d, dev, prob);
  }));
  $('[data-ticket-general]')?.addEventListener('click', () => openTicketDialog(d, null, null));
  const again = () => renderCustomer(c.id);
  $('[data-pause-customer]')?.addEventListener('click', () => openPauseDialog({ type: 'customer', id: c.id, customerId: c.id, name: c.name }, again));
  $$('[data-pause]').forEach((b) => (b.onclick = () => { const x = c.devices.find((v) => v.guid === b.dataset.pause); openPauseDialog({ type: 'device', id: x.guid, customerId: c.id, name: x.name }, again); }));
  $$('[data-unpause]').forEach((b) => (b.onclick = () => endPause(b.dataset.unpause, b.dataset.name, again)));
  $('#to-offer')?.addEventListener('click', () => {
    prefillCustomer(d.party);
    location.hash = '#/angebot';
  });
}

// ---------- Ticket aus einem Problem ----------
let curDetail = null;
const problemKey = (dev, p) => `${dev?.guid || 'kunde'}|${p?.alertId || p?.kind || 'allgemein'}`;
function ticketBtn(dev, p, i) {
  if (!curDetail?.party) return '';
  const link = curDetail.ticketLinks?.[problemKey(dev, p)];
  if (link) return `<span class="chip neutral" title="${esc(link.subject)} – angelegt von ${esc(link.by)} am ${date(link.createdAt)}">Ticket ${esc(link.number)}</span>`;
  return `<button class="btn small" type="button" data-ticket="${esc(dev?.guid || 'kunde')}|${i}">Ticket erstellen</button>`;
}

async function openTicketDialog(d, dev, prob) {
  const c = d.customer;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tk-title"><p class="loading">Lade Ticket-Stammdaten aus weclapp …</p></div>';
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  let meta, similar;
  try {
    [meta, similar] = await Promise.all([
      api('/atera-tickets/meta'),
      api(`/atera-tickets/similar?partyId=${encodeURIComponent(d.party.id)}&device=${encodeURIComponent(dev?.name || '')}`).then((r) => r.tickets).catch(() => []),
    ]);
  } catch (e) {
    back.querySelector('.modal').innerHTML = `<div class="banner crit"><div><b>weclapp nicht erreichbar</b>${esc(e.message)}</div></div><button class="btn" type="button" data-close>Schließen</button>`;
    back.querySelector('[data-close]').onclick = close;
    return;
  }
  const kindLabel = dev ? (dev.kind === 'firewall' ? 'Firewall' : 'Server') : '';
  const subject = (dev ? `${dev.name}: ${prob?.text || ''}` : prob ? prob.text : '').slice(0, 150);
  const lines = [
    `Kunde: ${c.name}`,
    dev ? `Gerät: ${dev.name} (${kindLabel}${dev.description ? `, ${dev.description}` : ''})` : null,
    prob ? `Problem: ${prob.text}` : null,
    prob?.since ? `Seit: ${dateTime(prob.since)}` : null,
    dev && dev.kind === 'server' ? `Zustand: ${dev.online ? 'online' : `offline seit ${dateTime(dev.lastSeen)}`}` : null,
    dev?.os ? `Betriebssystem: ${dev.os}` : null,
    dev?.ip ? `IP-Adresse: ${dev.ip}` : null,
    dev?.monitoring ? `Überwachung: ${dev.monitoring}` : null,
    dev?.url ? `Atera: ${dev.url}` : `Atera: ${c.url}`,
  ].filter(Boolean).join('\n');
  const prio = prob?.status === 'critical' ? meta.defaults.priorityCritical : meta.defaults.priorityWarning;
  const opt = (list, sel) => list.map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  back.querySelector('.modal').innerHTML = `
    <h2 id="tk-title" style="margin-bottom:4px">Ticket erstellen</h2>
    <p class="muted" style="margin:0 0 14px">${esc(c.name)}${d.party.number ? ` · ${esc(d.party.number)}` : ''} · wird in weclapp angelegt</p>
    ${similar.length ? `<div class="banner warn"><div><b>Offene Tickets${dev ? ` zu ${esc(dev.name)}` : ''} vorhanden</b>${similar.slice(0, 5).map((t) => `${esc(t.number)} · ${esc(t.subject)}${t.status ? ` (${esc(t.status)})` : ''}`).join('<br>')}<br>Bitte prüfen, ob das Problem dort schon bearbeitet wird.</div></div>` : ''}
    <form id="tk-form">
      <div class="field"><label for="tk-subject">Betreff</label><input id="tk-subject" maxlength="150" required value="${esc(subject)}"></div>
      <div class="field"><label for="tk-desc">Beschreibung</label><textarea id="tk-desc" rows="8">${esc(lines)}</textarea></div>
      <div class="grid-2" style="gap:0 14px">
        <div class="field"><label for="tk-prio">Priorität</label><select id="tk-prio">${opt(meta.priorities, prio)}</select></div>
        <div class="field"><label for="tk-user">Bearbeiter</label><select id="tk-user"><option value="">– niemand –</option>${opt(meta.users, meta.defaults.assignedUserId)}</select></div>
        <div class="field"><label for="tk-status">Status</label><select id="tk-status">${opt(meta.statuses, meta.defaults.statusId)}</select></div>
        <div class="field"><label for="tk-channel">Kanal</label><select id="tk-channel">${opt(meta.channels, meta.defaults.channelId)}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="tk-notify"><span>Kunden per E-Mail über das neue Ticket informieren (weclapp-Vorlage)</span></label>
      <p id="tk-error" class="error" role="alert" hidden></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" type="button" data-close>Abbrechen</button><button class="btn primary" type="submit" id="tk-submit">Ticket anlegen</button></div>
    </form>`;
  back.querySelector('[data-close]').onclick = close;
  back.querySelector('#tk-subject').focus();
  back.querySelector('#tk-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = back.querySelector('#tk-submit');
    const err = back.querySelector('#tk-error');
    btn.disabled = true; btn.textContent = 'Wird angelegt …'; err.hidden = true;
    try {
      const t = await api('/atera-tickets', { method: 'POST', body: {
        partyId: d.party.id,
        subject: back.querySelector('#tk-subject').value,
        description: back.querySelector('#tk-desc').value,
        priorityId: back.querySelector('#tk-prio').value,
        assignedUserId: back.querySelector('#tk-user').value,
        statusId: back.querySelector('#tk-status').value,
        channelId: back.querySelector('#tk-channel').value,
        notifyCustomer: back.querySelector('#tk-notify').checked,
        source: { customerId: c.id, deviceGuid: dev?.guid || null, alertId: prob?.alertId || null, kind: prob?.kind || null },
      } });
      close();
      toast(`Ticket ${t.number} angelegt`);
      renderCustomer(c.id);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = 'Ticket anlegen';
    }
  };
}

// ---------- Meldungen pausieren (Kunde oder Gerät) ----------
const pauseUntil = (p) => (p.untilOk ? 'bis behoben' : p.until ? `bis ${dateTime(p.until)}` : 'unbefristet');
const pauseText = (p) => `Pausiert ${pauseUntil(p)} · ${p.by || ''}${p.reason ? ` · „${p.reason}“` : ''}`;
function openPauseDialog({ type, id, customerId, name }, onDone) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pz-title" style="max-width:480px">
    <h2 id="pz-title" style="margin-bottom:4px">Meldungen pausieren</h2>
    <p class="muted" style="margin:0 0 14px">${type === 'customer' ? 'Kunde' : 'Gerät'} <b>${esc(name)}</b>${type === 'customer' ? ' mit allen Geräten' : ''}. Probleme bleiben grau sichtbar, zählen aber nicht als kritisch oder Warnung und erscheinen nicht auf der Startseite.</p>
    <form id="pz-form">
      <div class="field"><label for="pz-dur">Dauer</label><select id="pz-dur">
        <option value="ok">bis das Problem behoben ist (endet automatisch)</option>
        <option value="4h">4 Stunden</option><option value="1d">1 Tag</option><option value="3d">3 Tage</option>
        <option value="7d">1 Woche</option><option value="30d">1 Monat</option><option value="forever">unbefristet (bis ich die Pause beende)</option>
      </select></div>
      <div class="field"><label for="pz-reason">Grund</label><input id="pz-reason" maxlength="300" placeholder="z. B. Server wird getauscht, Kunde informiert, Wartungsfenster …"></div>
      <p id="pz-error" class="error" role="alert" hidden></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" type="button" data-close>Abbrechen</button><button class="btn primary" type="submit">Pausieren</button></div>
    </form></div>`;
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-close]').onclick = close;
  back.querySelector('#pz-reason').focus();
  back.querySelector('#pz-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/atera/pauses', { method: 'PUT', body: { type, id, customerId, duration: back.querySelector('#pz-dur').value, reason: back.querySelector('#pz-reason').value } });
      close(); toast(`${name} pausiert`); state.overview = null; onDone?.();
    } catch (ex) { const el = back.querySelector('#pz-error'); el.textContent = ex.message; el.hidden = false; }
  };
}
async function endPause(key, name, onDone) {
  try { await api(`/atera/pauses/${encodeURIComponent(key)}`, { method: 'DELETE' }); toast(`Pause für ${name} beendet`); state.overview = null; onDone?.(); } catch (e) { toast(e.message, true); }
}

const KIND = { server: 'Server', firewall: 'Firewall', workstation: 'Arbeitsplatz', other: 'Gerät' };
const seenText = (x) => (x.online === null ? `${esc(x.monitoring || '')}-Überwachung` : x.online ? 'online' : x.kind === 'firewall' ? 'nicht erreichbar' : `offline · ${ago(x.lastSeen)}`);
const PKIND = { offline: 'Offline', backup: 'Backup', disk: 'Speicher', alert: 'Alert' };
function device(x, open) {
  const pp0 = x.paused ? x.pausedProblems : x.problems;
  const p = pp0[0];
  const ownPause = x.paused?.type === 'device';
  return `<details class="device ${x.paused ? 'paused' : ''}" ${open ? 'open' : ''}>
    <summary>
      <span>${x.stale ? chip('neutral', 'Veraltet') : x.paused ? chip('neutral', 'Pausiert') : chip(x.status)}</span>
      <span><span class="d-name">${esc(x.name)}</span><br><span class="d-kind">${KIND[x.kind] || 'Gerät'}${x.description ? ` · ${esc(x.description)}` : ''}</span></span>
      <span class="d-problem">${x.stale ? `<span class="muted">${esc(x.staleText)}</span>` : p ? `<span class="${x.paused ? 'muted' : ''}">${esc(p.text)}</span>` + (pp0.length > 1 ? ` <span class="muted">(+${pp0.length - 1})</span>` : '') : '<span class="muted">Keine Auffälligkeiten</span>'}</span>
      <span class="d-seen">${seenText(x)}</span>
    </summary>
    <div class="device-body">
      ${x.paused ? `<div class="pause-note"><span>${esc(pauseText(x.paused))}${ownPause ? '' : ' (ganzer Kunde)'}</span>${ownPause ? `<button class="btn small" type="button" data-unpause="${esc(x.paused.key)}" data-name="${esc(x.name)}">Pause beenden</button>` : ''}</div>` : ''}
      ${pp0.length ? `<ul class="problem-list ${x.paused ? 'muted' : ''}">${pp0.map((pp, i) => `<li>${chip(x.paused ? 'neutral' : pp.status, PKIND[pp.kind] || 'Alert')} <span>${esc(pp.text)}</span>${pp.since ? `<span class="muted small">seit ${dateTime(pp.since)}</span>` : ''}${x.paused ? '' : ticketBtn(x, pp, i)}</li>`).join('')}</ul>` : ''}
      ${!x.paused && !x.stale ? `<div style="margin-bottom:8px"><button class="btn small ghost" type="button" data-pause="${esc(x.guid)}">Meldungen pausieren</button></div>` : ''}
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
// Kundenzuordnung Atera -> weclapp
// =====================================================================
const MATCHED = { cockpit: 'im Cockpit zugeordnet', 'atera-feld': 'über Atera-Feld', name: 'gleicher Name' };
let cmap = { data: null, searchFor: null, results: [], filter: 'open' };

async function renderCustomerMap() {
  const seq = navSeq;
  content.innerHTML = '<p class="loading">Lade Atera- und weclapp-Kunden …</p>';
  try { cmap.data = await api('/customer-map'); } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="banner crit"><div><b>Kundenzuordnung nicht verfügbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  drawCustomerMap();
}

function drawCustomerMap() {
  const all = cmap.data.customers;
  const open = all.filter((c) => !c.current?.id);
  const sure = open.filter((c) => c.suggestions[0]?.score >= 0.85);
  const list = cmap.filter === 'open' ? open : all;
  const row = (c) => {
    const cur = c.current;
    const sg = c.suggestions;
    return `<div class="card" style="padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:0"><b>${esc(c.name)}</b> ${chip(c.status)}<div class="muted small">Atera-Kunde ${esc(c.ateraId)}</div></div>
        <div style="text-align:right">${cur?.id ? `<b>${esc(cur.name)}</b><div class="muted small">${esc(cur.number || '')} · ${MATCHED[cur.matchedBy] || ''}</div>` : cur?.matchedBy === 'atera-feld-fehlt' ? `<span class="chip warning">Atera-Nummer ${esc(cur.number)} nicht in weclapp</span>` : '<span class="chip neutral">nicht zugeordnet</span>'}</div>
      </div>
      ${!cur?.id && sg.length ? `<div style="display:grid;gap:6px;margin-top:10px">${sg.map((p) => `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;background:var(--surface-2);border-radius:6px;padding:6px 10px"><span>Vorschlag: <b>${esc(p.name)}</b> <span class="muted small">${esc(p.number || '')} · ${Math.round(p.score * 100)} %</span></span><button class="btn small primary" type="button" data-cm-set="${esc(c.ateraId)}" data-party="${esc(p.id)}">Übernehmen</button></div>`).join('')}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn small ghost" type="button" data-cm-search="${esc(c.ateraId)}">${cur?.id ? 'Anderen weclapp-Kunden wählen' : 'weclapp-Kunden suchen'}</button>
        ${cur?.matchedBy === 'cockpit' ? `<button class="btn small ghost" type="button" data-cm-set="${esc(c.ateraId)}" data-party="">Zuordnung lösen</button>` : ''}
      </div>
      ${cmap.searchFor === c.ateraId ? `<div style="margin-top:10px"><input id="cm-q" class="search" style="max-width:none;width:100%" type="search" placeholder="Name oder Kundennummer in weclapp …" autocomplete="off"><div id="cm-results" style="display:grid;gap:6px;margin-top:8px"></div></div>` : ''}
    </div>`;
  };
  content.innerHTML = `
    <p style="margin:0 0 10px"><a href="#/kunden">← Kundenübersicht</a></p>
    <div class="page-head"><div><div class="eyebrow">Atera → weclapp</div><h1>Kundenzuordnung</h1></div>
      <div class="page-actions">${sure.length ? `<button class="btn primary" type="button" id="cm-all">${sure.length} sichere Vorschläge übernehmen (≥ 85 %)</button>` : ''}</div></div>
    <div class="banner info"><div><b>${all.length - open.length} von ${all.length} Kunden zugeordnet</b>Die Zuordnung verbindet einen Atera-Kunden mit seinem weclapp-Kunden – für Tickets, Verträge, offene Angebote und „Ticket erstellen“. Gespeichert im Cockpit; ein in Atera befülltes Feld „weclapp-Kundennummer“ wird ebenfalls erkannt. ${cmap.data.partyCount} weclapp-Kunden geladen.</div></div>
    <div class="toolbar"><div class="seg" role="group" aria-label="Filter">${[['open', `Offen (${open.length})`], ['all', `Alle (${all.length})`]].map(([k, t]) => `<button type="button" data-cm-filter="${k}" aria-pressed="${cmap.filter === k}">${t}</button>`).join('')}</div></div>
    ${list.length ? list.map(row).join('') : '<div class="banner ok"><div><b>Alle Kunden sind zugeordnet</b></div></div>'}`;
  $$('[data-cm-filter]').forEach((b) => (b.onclick = () => { cmap.filter = b.dataset.cmFilter; drawCustomerMap(); }));
  $$('[data-cm-search]').forEach((b) => (b.onclick = () => { cmap.searchFor = cmap.searchFor === b.dataset.cmSearch ? null : b.dataset.cmSearch; drawCustomerMap(); }));
  $$('[data-cm-set]').forEach((b) => (b.onclick = () => setCustomerMap(b.dataset.cmSet, b.dataset.party)));
  $('#cm-all')?.addEventListener('click', async () => {
    for (const c of sure) await api(`/customer-map/${encodeURIComponent(c.ateraId)}`, { method: 'PUT', body: { partyId: c.suggestions[0].id } }).catch((e) => toast(`${c.name}: ${e.message}`, true));
    toast(`${sure.length} Kunden zugeordnet`);
    renderCustomerMap();
  });
  const q = $('#cm-q');
  if (q) {
    q.focus();
    let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const { parties } = await api('/customer-map/search?q=' + encodeURIComponent(q.value)).catch(() => ({ parties: [] }));
      $('#cm-results').innerHTML = parties.map((p) => `<button class="btn ghost" style="justify-content:space-between" type="button" data-cm-pick="${esc(p.id)}"><span>${esc(p.name)}</span><span class="muted small">${esc(p.number || '')}</span></button>`).join('') || '<p class="muted">Kein Treffer.</p>';
      $$('[data-cm-pick]').forEach((b) => (b.onclick = () => setCustomerMap(cmap.searchFor, b.dataset.cmPick)));
    }, 250); };
  }
}

async function setCustomerMap(ateraId, partyId) {
  try {
    await api(`/customer-map/${encodeURIComponent(ateraId)}`, { method: 'PUT', body: { partyId: partyId || null } });
    cmap.searchFor = null;
    const y = window.scrollY;
    await renderCustomerMap();
    window.scrollTo(0, y);
  } catch (e) { toast(e.message, true); }
}

// =====================================================================
// Vertrieb (weclapp) – Rechnungen und Zahlungen nur unter Finanzen
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
  const q = d.quotations;
  const maxIntake = Array.isArray(d.intake) ? Math.max(...d.intake.map((m) => m.net), 1) : 1;
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">weclapp · Angebote, Pipeline, Aufträge</div><h1>Vertrieb</h1></div>
      <div class="page-actions"><span class="stamp">Stand: ${dateTime(d.generatedAt)}</span><a class="btn primary" href="#/angebot">Neues Angebot am Tablet</a></div>
    </div>
    <section class="kpis">
      <div class="kpi"><div class="label">Offene Angebote</div><div class="value">${v(q, (x) => eur0(x.net))}</div><div class="sub">${v(q, (x) => plural(x.count, 'Angebot', 'Angebote'))}</div>${errSub(q)}</div>
      <div class="kpi"><div class="label">Nachfassen (älter ${d.followUpDays} Tage)</div><div class="value">${v(q, (x) => x.followUpCount)}</div><div class="sub">${v(q, (x) => eur0(x.followUpNet) + ' netto')}</div></div>
      <div class="kpi"><div class="label">Angenommen diesen Monat</div><div class="value">${v(d.accepted, (x) => eur0(x.net))}</div><div class="sub">${v(d.accepted, (x) => plural(x.count, 'Angebot', 'Angebote'))}</div>${errSub(d.accepted)}</div>
      <div class="kpi"><div class="label">Managed Services / Monat</div><div class="value">${v(d.contracts, (x) => eur0(x.monthly))}</div><div class="sub">${v(d.contracts, (x) => plural(x.count, 'aktiver Vertrag', 'aktive Verträge'))}</div>${errSub(d.contracts)}</div>
      <div class="kpi"><div class="label">Offene Aufträge</div><div class="value">${v(d.orders, (x) => eur0(x.net))}</div><div class="sub">${v(d.orders, (x) => plural(x.count, 'Auftrag', 'Aufträge'))}</div>${errSub(d.orders)}</div>
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
        <div class="card-head"><h2>Größte offene Angebote</h2><span class="muted small">netto</span></div>
        ${err(q) ? `<p class="empty">${esc(q.error)}</p>` : q.list.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Kunde</th><th>Datum</th><th class="num">Netto</th></tr></thead><tbody>${[...q.list].sort((a, b) => b.net - a.net).slice(0, 8).map((x) => `<tr><td class="muted">${esc(x.number)}</td><td class="wrap">${esc(x.customer)}</td><td>${date(x.date)}</td><td class="num">${eur(x.net)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine offenen Angebote.</p>'}
      </div>
    </div>
  `;
  $$('[data-retry]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/offer/${encodeURIComponent(b.dataset.retry)}/retry`, { method: 'POST' }); toast(r.weclapp?.quotationNumber ? `In weclapp angelegt: Angebot ${r.weclapp.quotationNumber}` : 'weclapp hat wieder nicht angenommen'); renderDashboard(); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

// =====================================================================
// Finanzen – Geschäftsführung & Buchhaltung (nur Entra-Gruppe)
// =====================================================================
function lineChart(points, h = 160) {
  if (!points?.length) return '<p class="empty">Keine Buchungen.</p>';
  const w = 600, pad = 6, vals = points.map((p) => p.balance);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 1);
  const min = lo - span * 0.08, max = hi + span * 0.08; // auf den tatsächlichen Bereich skalieren
  const x = (i) => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const zero = min < 0 && max > 0 ? `<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" class="lc-zero"/>` : '';
  return `<svg class="linechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Kontostand der letzten 90 Tage">${zero}<path d="${d} L${x(points.length - 1)},${h} L${x(0)},${h} Z" class="lc-area"/><path d="${d}" class="lc-line"/></svg>
    <div class="lc-axis"><span>${date(points[0].date)}</span><span>min ${eur0(lo)} · max ${eur0(hi)}</span><span>heute</span></div>`;
}
function pairChart(months, label) {
  const max = Math.max(1, ...months.flatMap((m) => [m.current, m.previous]));
  return `<div class="pairchart" role="img" aria-label="${esc(label)}">${months.map((m) => `<div class="pc-col ${m.future ? 'future' : ''}" title="${esc(m.month)}: ${eur0(m.current)} (Vorjahr ${eur0(m.previous)})">
    <div class="pc-bars"><i class="prev" style="height:${Math.max(0, (m.previous / max) * 100)}%"></i><i class="cur" style="height:${Math.max(0, (m.current / max) * 100)}%"></i></div><span>${esc(m.month)}</span></div>`).join('')}</div>
    <div class="pc-legend"><span><i class="cur"></i>${new Date().getFullYear()}</span><span><i class="prev"></i>${new Date().getFullYear() - 1}</span></div>`;
}
const pct = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / Math.abs(b)) * 100))} % zum Vorjahr` : 'kein Vorjahreswert');

async function renderFinance() {
  const seq = navSeq;
  if (!state.me?.roles?.finance) {
    content.innerHTML = '<div class="banner info"><div><b>Kein Zugriff auf Finanzen</b>Dieser Bereich ist der Geschäftsführung und Buchhaltung vorbehalten (Entra-Gruppe „SIT-Cockpit Finanzen“).</div></div>';
    return;
  }
  content.innerHTML = '<p class="loading">Lade Finanzdaten aus weclapp …</p>';
  let f;
  try { f = await api('/finance'); } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="banner crit"><div><b>Finanzdaten nicht verfügbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  const err = (s) => s && s.error;
  const v = (s, fn) => (err(s) || !s ? '–' : fn(s));
  const errSub = (s) => (err(s) ? `<div class="sub">${esc(s.error)}</div>` : '');
  const b = f.bank, r = f.receivables, p = f.payables;
  const lastSync = !err(b) && b.accounts.length ? Math.min(...b.accounts.map((a) => a.lastSync || Infinity)) : null;
  content.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Geschäftsführung &amp; Buchhaltung · nur Gruppe Finanzen</div><h1>Finanzen</h1></div>
      <div class="page-actions">${financeTabs('')}<span class="stamp">Stand: ${dateTime(f.generatedAt)}</span></div></div>
    ${!err(b) && (b.stale || b.accounts.some((a) => a.failure)) ? `<div class="banner warn"><div><b>Bankdaten nicht aktuell</b>${b.accounts.some((a) => a.failure) ? 'Bei mindestens einem Konto meldet weclapp einen Verbindungsfehler. ' : ''}Letzte Synchronisation ${lastSync && lastSync !== Infinity ? dateTime(lastSync) : 'unbekannt'} – Kontostände in weclapp aktualisieren.</div></div>` : ''}
    <section class="kpis">
      <div class="kpi"><div class="label">Kontostand gesamt</div><div class="value">${v(b, (x) => eur0(x.balance))}</div><div class="sub">${v(b, (x) => `${plural(x.accounts.length, 'Konto', 'Konten')}${x.creditLine ? ` · Rahmen ${eur0(x.creditLine)}` : ''}`)}</div>${errSub(b)}</div>
      <div class="kpi"><div class="label">Forderungen offen</div><div class="value">${v(r, (x) => eur0(x.total))}</div><div class="sub">${v(r, (x) => `davon überfällig ${eur0(x.overdue)}`)}</div>${errSub(r)}</div>
      <div class="kpi"><div class="label">Eingangsrechnungen offen</div><div class="value">${v(p, (x) => eur0(x.total))}</div><div class="sub">${v(p, (x) => `${eur0(x.due7)} in 7 Tagen · ${eur0(x.overdue)} überfällig`)}</div>${errSub(p)}</div>
      <div class="kpi"><div class="label">Umsatz seit Jahresbeginn</div><div class="value">${v(f.revenue, (x) => eur0(x.ytd))}</div><div class="sub">${v(f.revenue, (x) => pct(x.ytd, x.ytdPrev))}</div>${errSub(f.revenue)}</div>
      <div class="kpi"><div class="label">Ergebnis-Näherung YTD</div><div class="value">${f.result ? eur0(f.result.ytd) : '–'}</div><div class="sub">${f.result ? `Umsatz − Eingangsrechnungen · Vorjahr ${eur0(f.result.ytdPrev)}` : ''}</div></div>
      <div class="kpi"><div class="label">USt-Zahllast ${f.vat ? esc(f.vat.monthLabel) : ''}</div><div class="value">${f.vat ? eur0(f.vat.month) : '–'}</div><div class="sub">${f.vat ? `${esc(f.vat.prevMonthLabel)}: ${eur0(f.vat.prevMonth)} · vorläufig` : ''}</div></div>
      <a class="kpi kpi-link" href="#/finanzen/vertraege"><div class="label">Managed Services / Monat</div><div class="value">${v(f.mrr, (x) => eur0(x.monthly))}</div><div class="sub">${v(f.mrr, (x) => plural(x.count, 'aktiver Vertrag', 'aktive Verträge'))} · Rentabilität ansehen</div>${errSub(f.mrr)}</a>
    </section>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>Liquidität</h2><span class="muted small">Kontostand der letzten 90 Tage</span></div>
        ${err(b) ? `<p class="empty">${esc(b.error)}</p>` : `${b.trend ? lineChart(b.trend) : `<p class="empty">${esc(b.trendError || 'Kein Verlauf')}</p>`}
        ${b.in90 != null ? `<p class="muted small" style="margin:6px 0 0">90 Tage: Eingänge ${eur0(b.in90)} · Ausgänge ${eur0(b.out90)}</p>` : ''}
        <table style="margin-top:12px"><tbody>${b.accounts.map((a) => `<tr><td class="wrap"><b>${esc(a.name)}</b> <span class="muted small">${esc(a.iban)}</span>${a.failure ? ' <span class="chip neutral">Verbindungsfehler</span>' : ''}<div class="muted small">Sync ${a.lastSync ? dateTime(a.lastSync) : '–'}</div></td><td class="num">${eur(a.balance)}</td></tr>`).join('')}</tbody></table>`}
      </div>
      <div class="card"><div class="card-head"><h2>Liquiditätsvorschau</h2><span class="muted small">ohne Gehälter, Miete u. ä.</span></div>
        ${f.forecast ? `<table><thead><tr><th>Zeitraum</th><th class="num">Eingänge</th><th class="num">Ausgänge</th><th class="num">Kontostand</th></tr></thead><tbody>${f.forecast.map((x) => `<tr><td>in ${x.days} Tagen</td><td class="num">+${eur0(x.inflow)}</td><td class="num">−${eur0(x.outflow)}</td><td class="num"><b>${eur0(x.balance)}</b></td></tr>`).join('')}</tbody></table>
        <p class="muted small">Kontostand heute + fällige Forderungen (bis 90 Tage überfällig) − fällige Eingangsrechnungen.</p>` : '<p class="empty">Vorschau braucht Bank, Forderungen und Eingangsrechnungen.</p>'}
        <h3 style="margin-top:16px">Forderungen nach Alter</h3>
        ${err(r) ? `<p class="empty">${esc(r.error)}</p>` : `<div class="aging">${r.buckets.map((x) => { const max = Math.max(1, ...r.buckets.map((y) => Math.abs(y.amount))); return `<div class="ag-row"><span>${esc(x.label)}</span><span class="ag-bar"><i style="width:${(Math.abs(x.amount) / max) * 100}%"></i></span><span class="num">${eur0(x.amount)}</span></div>`; }).join('')}</div>`}
      </div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h2>Umsatz je Monat</h2><span class="muted small">netto, Ausgangsrechnungen</span></div>${err(f.revenue) ? `<p class="empty">${esc(f.revenue.error)}</p>` : pairChart(f.revenue.months, 'Umsatz je Monat')}</div>
      <div class="card"><div class="card-head"><h2>Eingangsrechnungen je Monat</h2><span class="muted small">netto</span></div>${err(f.costs) ? `<p class="empty">${esc(f.costs.error)}</p>` : pairChart(f.costs.months, 'Eingangsrechnungen je Monat')}</div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h2>Überfällige Forderungen</h2><span class="muted small">brutto</span></div>
        ${err(r) ? `<p class="empty">${esc(r.error)}</p>` : `${r.topDebtors.length ? `<p class="muted small" style="margin:0 0 8px">Größte Schuldner: ${r.topDebtors.map((x) => `${esc(x.customer)} ${eur0(x.amount)}`).join(' · ')}</p>` : ''}
        ${r.list.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Kunde</th><th>Fällig seit</th><th class="num">Betrag</th></tr></thead><tbody>${r.list.map((x) => `<tr><td class="muted">${esc(x.number)}</td><td class="wrap">${esc(x.customer)}</td><td>${chip('neutral', `${x.days} Tage`)}</td><td class="num">${eur(x.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine überfälligen Forderungen.</p>'}`}
      </div>
      <div class="card"><div class="card-head"><h2>Fällige Eingangsrechnungen</h2><span class="muted small">nach Fälligkeit</span></div>
        ${err(p) ? `<p class="empty">${esc(p.error)}</p>` : p.list.length ? `${p.blocked ? `<p class="muted small" style="margin:0 0 8px">${plural(p.blocked, 'Rechnung mit Zahlungssperre', 'Rechnungen mit Zahlungssperre')}</p>` : ''}<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Lieferant</th><th>Fällig</th><th class="num">Betrag</th></tr></thead><tbody>${p.list.map((x) => `<tr><td class="muted">${esc(x.number || '')}</td><td class="wrap">${esc(x.supplier)}${x.blocked ? ' <span class="chip neutral">gesperrt</span>' : ''}</td><td>${x.days < 0 ? chip('neutral', `seit ${-x.days} Tagen`) : x.days === 0 ? 'heute' : `in ${x.days} Tagen`}</td><td class="num">${eur(x.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine offenen Eingangsrechnungen.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:18px"><h3>Hinweise zur Berechnung</h3><ul class="muted small" style="margin:6px 0 0;padding-left:18px">${f.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
}

// ---------- Finanzen › Wartungsverträge ----------
const financeTabs = (active) => `<nav class="subtabs" aria-label="Finanzen">${[['', 'Übersicht'], ['vertraege', 'Wartungsverträge']].map(([k, l]) => `<a href="#/finanzen${k ? `/${k}` : ''}"${k === active ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
const CT_KEY = 'sit-cockpit-contracts';
function contractPrefs() {
  try { return { months: 12, rate: '', type: '', hours: 'unbilled', ...JSON.parse(localStorage.getItem(CT_KEY) || '{}') }; } catch { return { months: 12, rate: '', type: '', hours: 'unbilled' }; }
}
const hours = (h) => `${nf(Math.round(h * 10) / 10)} h`;
const signedEur = (v) => (v < 0 ? `−${eur0(-v)}` : eur0(v));
const signedPct = (p) => (p < 0 ? `−${-p} %` : `${p} %`);

async function renderContracts() {
  const seq = navSeq;
  if (!state.me?.roles?.finance) { renderFinance(); return; }
  const prefs = contractPrefs();
  content.innerHTML = '<p class="loading">Lade Verträge, Zeitbuchungen und Einkaufspreise aus weclapp …</p>';
  let d;
  try {
    const q = new URLSearchParams({ months: prefs.months, hours: prefs.hours, ...(prefs.type ? { type: prefs.type } : {}), ...(prefs.rate ? { rate: prefs.rate } : {}) });
    d = await api(`/finance/contracts?${q}`);
  } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="page-head"><div><div class="eyebrow">Finanzen · nur Gruppe Finanzen</div><h1>Wartungsverträge</h1></div><div class="page-actions">${financeTabs('vertraege')}</div></div>
      <div class="banner crit"><div><b>Verträge nicht verfügbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  const t = d.totals, wo = d.without;
  const woRows = wo.rows || [];
  const soon = Date.now() + 90 * 864e5;
  const bar = (c) => {
    const base = Math.max(c.revenue, c.licenseCost + c.laborCost, 1);
    const w = (x) => `${Math.max(0, (x / base) * 100).toFixed(1)}%`;
    return `<div class="costbar" title="Lizenzen ${eur0(c.licenseCost)} · Stunden ${eur0(c.laborCost)} · Ertrag ${eur0(c.revenue)}"><i class="lic" style="width:${w(c.licenseCost)}"></i><i class="lab" style="width:${w(c.laborCost)}"></i>${c.margin > 0 ? `<i class="mar" style="width:${w(c.margin)}"></i>` : ''}${c.margin < 0 ? `<b class="rev" style="left:${w(c.revenue)}"></b>` : ''}</div>`;
  };
  const contractLine = (k) => `<li><b>${esc(k.number || k.name || 'Vertrag')}</b>${k.name && k.number ? ` ${esc(k.name)}` : ''} ${k.types.map((x) => chip('neutral', x)).join(' ')}
    <span class="muted">· ${eur0(k.monthly)}/Monat · seit ${date(k.start)}${k.unlimited ? ' · unbefristet' : ` · bis ${date(k.end)}`}${k.costSource === 'vertrag' ? ' · Kosten aus Vertrag' : ''}${k.carriesHours ? '' : ' · nur Lizenzen, keine Stunden'}</span>
    ${k.termination && k.termination > Date.now() && k.termination < soon ? ` ${chip('neutral', `kündbar bis ${date(k.termination)}`)}` : ''}
    <ul>${k.items.map((it) => `<li>${nf(it.quantity)} × ${esc(it.title)} <span class="muted">${eur(it.monthly)}/Monat${it.purchase != null ? ` · EK ${eur(it.purchase)}` : ''}</span>${it.service ? ` ${chip('neutral', 'Leistung')}` : it.purchase == null && k.costSource !== 'vertrag' ? ` ${chip('neutral', 'kein EK')}` : ''}</li>`).join('')}</ul></li>`;
  const typeName = d.types.find((x) => x.id === d.selectedType)?.name;
  content.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Finanzen · nur Gruppe Finanzen</div><h1>Wartungsverträge</h1></div>
      <div class="page-actions">${financeTabs('vertraege')}<span class="stamp">Stand: ${dateTime(d.generatedAt)}</span></div></div>
    <form class="toolbar ct-filter" id="ct-form">
      <label>Zeitraum <select name="months">${[3, 6, 12, 24].map((m) => `<option value="${m}"${m === d.period.months ? ' selected' : ''}>letzte ${m} Monate</option>`).join('')}</select></label>
      <label>Vertragstyp <select name="type"><option value="">alle aktiven Verträge</option>${d.types.map((x) => `<option value="${esc(x.id)}"${x.id === d.selectedType ? ' selected' : ''}>${esc(x.name)} (${x.count})</option>`).join('')}</select></label>
      <label>Stunden <select name="hours"><option value="unbilled"${d.hours !== 'all' ? ' selected' : ''}>nur nie fakturierte</option><option value="all"${d.hours === 'all' ? ' selected' : ''}>alle Stunden</option></select></label>
      <label>Interner Stundensatz <span class="ct-rate"><input name="rate" type="number" min="1" step="1" inputmode="numeric" value="${d.rate}" aria-label="Interner Stundensatz in Euro"> €/h</span></label>
    </form>
    <section class="kpis">
      <div class="kpi"><div class="label">Vertragswert / Monat</div><div class="value">${eur0(t.monthly)}</div><div class="sub">${plural(t.contracts, 'Vertrag', 'Verträge')} · ${plural(t.customers, 'Kunde', 'Kunden')}${typeName ? ` · ${esc(typeName)}` : ''}</div></div>
      <div class="kpi"><div class="label">Ertrag ${d.period.months} Monate</div><div class="value">${eur0(t.revenue)}</div><div class="sub">anteilig je Vertragslaufzeit</div></div>
      <div class="kpi"><div class="label">Lizenzkosten</div><div class="value">${eur0(t.licenseCost)}</div><div class="sub">${t.revenue ? `${Math.round((t.licenseCost / t.revenue) * 100)} % vom Ertrag` : ''} · ${eur0(t.monthlyCost)}/Monat</div></div>
      <div class="kpi"><div class="label">Stundenaufwand</div><div class="value">${d.hoursError ? '–' : hours(t.hours)}</div><div class="sub">${d.hoursError ? esc(d.hoursError) : `${eur0(t.laborCost)} bei ${eur0(d.rate)}/h`}</div></div>
      <div class="kpi"><div class="label">Deckungsbeitrag</div><div class="value">${signedEur(t.margin)}</div><div class="sub">${t.marginPct != null ? `${signedPct(t.marginPct)} vom Ertrag` : ''}${t.losing ? ` · ${plural(t.losing, 'Kunde', 'Kunden')} unter Kosten` : ''}</div></div>
      <div class="kpi"><div class="label">Kunden ohne Vertrag</div><div class="value">${wo.error ? '–' : woRows.length}</div><div class="sub">${wo.error ? esc(wo.error) : `davon ${woRows.filter((x) => x.atera).length} in Atera verwaltet`}</div></div>
    </section>
    <div class="card">
      <div class="card-head"><h2>Rentabilität je Kunde</h2><span class="muted small">schwächste zuerst · Zeile öffnen für Vertragsdetails</span></div>
      <div class="ct-legend muted small"><span><i class="lic"></i>Lizenzen</span><span><i class="lab"></i>Stunden</span><span><i class="mar"></i>Deckungsbeitrag</span><span><b class="rev"></b>Ertrag (wenn Kosten darüber)</span></div>
      ${d.customers.length ? `<div class="table-wrap"><table class="ct-table"><thead><tr><th>Kunde</th><th class="num">Monatlich</th><th class="num">Ertrag</th><th class="num">Lizenzen</th><th class="num">Stunden</th><th class="num">Stundenkosten</th><th class="num">Deckungsbeitrag</th><th class="num" title="Ertrag abzüglich Lizenzen je geleisteter Stunde">€ je Stunde</th><th class="ct-barcol">Verteilung</th></tr></thead><tbody>
        ${d.customers.map((c) => `<tr>
          <td class="wrap"><details><summary><b>${esc(c.name)}</b> <span class="muted small">${esc(c.number)}</span>${c.since ? `<div class="muted small">Vertrag seit ${date(c.since)} – gerechnet ab dann</div>` : ''}</summary><ul class="ct-contracts">${c.contracts.map(contractLine).join('')}</ul></details></td>
          <td class="num">${eur0(c.monthly)}</td>
          <td class="num">${eur0(c.revenue)}</td>
          <td class="num">${eur0(c.licenseCost)}</td>
          <td class="num" title="gesamt ${hours(c.hoursTotal)} · fakturiert ${hours(c.hoursInvoiced)} · noch offen ${hours(c.hoursOpen)}">${c.carriesHours ? hours(c.hoursCounted) : '<span class="muted" title="Vertrag ohne eigene Leistung – nur Lizenzmarge">–</span>'}${c.hoursInvoiced ? `<div class="muted small">${hours(c.hoursInvoiced)} fakturiert</div>` : ''}</td>
          <td class="num">${eur0(c.laborCost)}</td>
          <td class="num"><b>${signedEur(c.margin)}</b>${c.marginPct != null ? `<div class="muted small">${signedPct(c.marginPct)}</div>` : ''}${c.margin < 0 ? ` ${chip('neutral', 'unter Kosten')}` : ''}</td>
          <td class="num">${c.yieldPerHour != null ? signedEur(c.yieldPerHour) : '<span class="muted">–</span>'}</td>
          <td class="ct-barcol">${bar(c)}</td>
        </tr>`).join('')}
      </tbody><tfoot><tr><td><b>Summe</b></td><td class="num">${eur0(t.monthly)}</td><td class="num">${eur0(t.revenue)}</td><td class="num">${eur0(t.licenseCost)}</td><td class="num">${hours(t.hours)}</td><td class="num">${eur0(t.laborCost)}</td><td class="num"><b>${signedEur(t.margin)}</b></td><td></td><td></td></tr></tfoot></table></div>` : `<p class="empty">Keine aktiven Verträge${typeName ? ` vom Typ „${esc(typeName)}“` : ''}.</p>`}
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Kunden ohne ${typeName ? esc(typeName) : 'Vertrag'}</h2><span class="muted small">in Atera verwaltet zuerst, dann nach Aufwand</span></div>
      ${wo.error ? `<p class="empty">${esc(wo.error)}</p>` : woRows.length ? `<div class="table-wrap"><table><thead><tr><th>Kunde</th><th>Hinweis</th><th class="num">Umsatz 12 Monate</th><th class="num">Stunden ${d.period.months} Monate</th><th class="num">davon fakturiert</th><th></th></tr></thead><tbody>
        ${woRows.map((x) => `<tr><td class="wrap"><b>${esc(x.name)}</b> <span class="muted small">${esc(x.number)}</span></td>
          <td>${x.atera ? chip('neutral', 'in Atera verwaltet') : ''} ${x.otherContract ? chip('neutral', 'anderer Vertragstyp') : ''}</td>
          <td class="num">${eur0(x.revenue12)}</td><td class="num">${hours(x.hours)}</td><td class="num">${hours(x.hoursInvoiced)}</td>
          <td><a class="small" href="#/angebot">Angebot</a></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Alle relevanten Kunden haben einen Vertrag.</p>'}
    </div>
    ${d.missingPrices?.length ? `<div class="card" style="margin-top:18px"><div class="card-head"><h2>Artikel ohne Einkaufspreis</h2><span class="muted small">in weclapp am Artikel als Bezugsquelle pflegen</span></div>
      <div class="table-wrap"><table><thead><tr><th>Artikelnr.</th><th>Artikel</th><th class="num">in Verträgen</th></tr></thead><tbody>${d.missingPrices.map((a) => `<tr><td class="muted">${esc(a.number)}</td><td class="wrap">${esc(a.name)}</td><td class="num">${a.contracts}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card" style="margin-top:18px"><h3>So wird gerechnet</h3><ul class="muted small" style="margin:6px 0 0;padding-left:18px">${d.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${d.diag?.length ? `<h3 style="margin-top:14px">Datengrundlage aus weclapp</h3><ul class="muted small" style="margin:6px 0 0;padding-left:18px">${d.diag.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;

  const form = $('#ct-form');
  const save = () => {
    const f = new FormData(form);
    const next = { months: Number(f.get('months')), type: f.get('type'), hours: f.get('hours'), rate: Number(f.get('rate')) > 0 ? Number(f.get('rate')) : '' };
    try { localStorage.setItem(CT_KEY, JSON.stringify(next)); } catch { /* egal */ }
    renderContracts();
  };
  form.onchange = save;
  form.onsubmit = (e) => { e.preventDefault(); save(); };
}

// =====================================================================
// Backups – Wochenansicht je Kunde (Sicherungsereignisse aus Atera, z. B. Veeam Ereignis-ID 190)
// =====================================================================
const BK = {
  failed: ['✗', 'Fehlgeschlagen'], warning: ['!', 'Warnung'], success: ['✓', 'Erfolg gemeldet'],
  quiet: ['✓', 'Kein Fehler gemeldet'], missing: ['?', 'Keine Meldung, obwohl sonst Erfolge gemeldet werden'], future: ['', 'Nacht noch nicht vorbei'],
};
const BK_RES = { failed: ['critical', 'Fehlgeschlagen'], warning: ['warning', 'Warnung'], success: ['ok', 'Erfolgreich'], info: ['neutral', 'Info'] };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const bkState = { week: 0, onlyProblems: false, q: '', open: new Set() };
const bkDay = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });
const bkNext = (k) => new Date(Date.parse(`${k}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
const isoWeek = (k) => {
  const d = new Date(`${k}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7);
};
const bkTime = (ms) => new Date(ms).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function renderBackups({ refresh = false } = {}) {
  const seq = navSeq;
  content.innerHTML = `<p class="loading">${refresh ? 'Hole Backup-Ereignisse neu aus Atera …' : 'Lade Backup-Ereignisse aus Atera …'}</p>`;
  let d;
  try { d = await api(`/backups?week=${bkState.week}${refresh ? '&refresh=1' : ''}`); } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="banner crit"><div><b>Backup-Übersicht nicht verfügbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  const t = d.totals;
  if (bkState.week === 0) { const nb = $('#nav-backups'); if (nb) { nb.hidden = !t.lastNightFailed; nb.textContent = t.lastNightFailed || ''; } }
  const first = d.days[0].key, lastDay = d.days[6].key;
  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Atera · Ereignisprotokoll (z. B. Veeam, Ereignis-ID 190)</div><h1>Backups</h1></div>
      <div class="page-actions">
        <span class="stamp">${d.syncedAt ? `Stand: ${ago(d.syncedAt)}` : 'noch nicht abgerufen'}${d.loading ? ' · lädt …' : ''}</span>
        <button class="btn ghost" type="button" id="bk-refresh">Neu abrufen</button>
      </div>
    </div>
    ${d.error ? `<div class="banner warn"><div><b>Atera-Abruf eingeschränkt</b>${esc(d.error)} – angezeigt wird der letzte Stand.</div></div>` : ''}
    ${!d.successSeen ? '<div class="banner info"><div><b>Grüner Haken = kein Fehler gemeldet</b>Atera meldet derzeit nur fehlgeschlagene Sicherungen. Ein Haken heißt daher „kein Fehler gemeldet“, nicht sicher „gelaufen“. Für echte Erfolgsmeldungen in der Atera-Ereignisüberwachung (Veeam Backup, Ereignis-ID 190) zusätzlich die Stufe „Information“ überwachen – das Cockpit nutzt sie dann automatisch.</div></div>' : ''}
    <section class="kpis">
      <div class="kpi ${t.lastNightFailed ? 'crit' : ''}"><div class="label">Letzte Nacht fehlgeschlagen</div><div class="value">${t.lastNightFailed ?? '–'}</div><div class="sub">${t.lastNightFailed != null ? `Nacht ${bkDay(t.lastNight)} → ${bkDay(bkNext(t.lastNight))}` : 'nicht in dieser Woche'}</div></div>
      <div class="kpi ${t.customersFailed ? 'warn' : ''}"><div class="label">Kunden mit Fehlern</div><div class="value">${t.customersFailed}</div><div class="sub">in KW ${isoWeek(first)}</div></div>
      <div class="kpi"><div class="label">Fehlgeschlagene Nächte</div><div class="value">${t.failedCells}</div><div class="sub">Kunde × Nacht</div></div>
      <div class="kpi"><div class="label">Ereignisse</div><div class="value">${t.events}</div><div class="sub">${t.reportingSuccess ? `${plural(t.reportingSuccess, 'Kunde meldet', 'Kunden melden')} auch Erfolge` : 'nur Fehlermeldungen'}</div></div>
    </section>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Woche">
        <button type="button" id="bk-prev" ${d.week <= -7 ? 'disabled' : ''}>‹ Vorwoche</button>
        <button type="button" aria-pressed="true" id="bk-now" title="zur aktuellen Woche">KW ${isoWeek(first)} · ${bkDay(first)}–${bkDay(lastDay)}</button>
        <button type="button" id="bk-next" ${d.week >= 0 ? 'disabled' : ''}>Nächste ›</button>
      </div>
      <input id="bk-search" class="search" type="search" placeholder="Kunde suchen …" value="${esc(bkState.q)}" aria-label="Kunde suchen">
      <label class="check"><input type="checkbox" id="bk-only"${bkState.onlyProblems ? ' checked' : ''}> nur mit Problemen</label>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap"><table class="bk-table">
        <thead><tr><th>Kunde</th>${d.days.map((x) => `<th class="bk-day${x.lastNight ? ' last' : ''}" title="${x.lastNight ? 'letzte Nacht' : ''}">${WD[x.weekday]}<br><span class="muted small">${bkDay(x.key)}</span></th>`).join('')}<th class="num">Fehler</th></tr></thead>
        <tbody id="bk-body"></tbody>
      </table></div>
    </div>
    <p class="muted small bk-legend">${['success', 'quiet', 'warning', 'failed', 'missing'].filter((k) => d.successSeen || !['success', 'missing'].includes(k)).map((k) => `<span><span class="bk-sym bk-${k}">${BK[k][0]}</span> ${BK[k][1]}</span>`).join('')}<span>Spalte = Sicherungsnacht (Ereignisse bis ${d.cutoffHour} Uhr zählen zur Nacht davor). Zeile anklicken: Ereignisse mit Beschreibung.</span></p>`;

  const evHtml = (e) => `<details class="bk-ev">
      <summary><span class="muted small bk-when">${bkTime(e.at)}</span>${chip(BK_RES[e.result]?.[0] || 'neutral', BK_RES[e.result]?.[1] || e.result)}
        <span class="bk-what"><b>${esc(e.device)}</b> · ${esc(e.source || 'Ereignis')}${e.eventId ? ` · Ereignis-ID ${esc(e.eventId)}` : ''}${e.job ? ` · Job „${esc(e.job)}“` : ''}${e.retry ? ' · Wiederholung' : ''}<br><span class="bk-sum">${esc(e.summary)}</span></span></summary>
      <pre class="bk-text">${esc(e.text || e.title)}</pre>
    </details>`;
  const detail = (c) => {
    const days = c.cells.map((x, i) => ({ ...x, i })).filter((x) => x.events.length).reverse();
    return `<tr class="bk-detail"><td colspan="${d.days.length + 2}">
      ${days.length ? days.map((x) => `<div class="bk-daygrp"><h4>Nacht ${WD[d.days[x.i].weekday]} ${bkDay(x.day)} · <span class="bk-sym bk-${x.status}">${BK[x.status][0]}</span> ${BK[x.status][1]}</h4>${x.events.map(evHtml).join('')}</div>`).join('')
        : `<p class="muted" style="margin:4px 0">Keine Backup-Meldungen in dieser Woche${c.reportsSuccess ? '' : ' – Atera meldet hier nur Fehler'}.</p>`}
      <p style="margin:8px 0 0"><a href="#/kunden/${encodeURIComponent(c.id)}">Zum Kunden →</a>${c.lastFailure ? ` <span class="muted small">· letzter Fehler ${dateTime(c.lastFailure)}</span>` : ''}</p>
    </td></tr>`;
  };
  const draw = () => {
    const q = bkState.q.trim().toLowerCase();
    const rows = d.customers.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!bkState.onlyProblems || c.failed || c.warnings || c.missing));
    $('#bk-body').innerHTML = rows.length ? rows.map((c) => `<tr class="bk-row${bkState.open.has(c.id) ? ' open' : ''}" data-id="${esc(c.id)}" tabindex="0" aria-expanded="${bkState.open.has(c.id)}">
        <td><span class="bk-caret" aria-hidden="true">▸</span><b>${esc(c.name)}</b>${c.paused ? ' <span class="chip neutral">Pausiert</span>' : ''}</td>
        ${c.cells.map((x, i) => `<td class="bk-cell${d.days[i].lastNight ? ' last' : ''}" title="${esc(`${WD[d.days[i].weekday]} ${bkDay(x.day)}: ${BK[x.status][1]}${x.events.length ? ` · ${plural(x.events.length, 'Ereignis', 'Ereignisse')}` : ''}`)}"><span class="bk-sym bk-${x.status}">${BK[x.status][0]}</span></td>`).join('')}
        <td class="num">${c.failed ? `<b>${c.failed}</b>` : '<span class="muted">0</span>'}</td></tr>${bkState.open.has(c.id) ? detail(c) : ''}`).join('')
      : `<tr><td colspan="${d.days.length + 2}"><p class="empty">${bkState.onlyProblems ? 'Keine Probleme in dieser Woche.' : 'Kein Kunde gefunden.'}</p></td></tr>`;
    $$('#bk-body .bk-row').forEach((tr) => {
      const toggle = () => { const id = tr.dataset.id; if (bkState.open.has(id)) bkState.open.delete(id); else bkState.open.add(id); draw(); };
      tr.onclick = toggle;
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    });
  };
  draw();
  $('#bk-refresh').onclick = () => renderBackups({ refresh: true });
  $('#bk-prev').onclick = () => { bkState.week -= 1; renderBackups(); };
  $('#bk-next').onclick = () => { bkState.week = Math.min(0, bkState.week + 1); renderBackups(); };
  $('#bk-now').onclick = () => { if (bkState.week) { bkState.week = 0; renderBackups(); } };
  $('#bk-search').oninput = (e) => { bkState.q = e.target.value; draw(); };
  $('#bk-only').onchange = (e) => { bkState.onlyProblems = e.target.checked; draw(); };
}

// =====================================================================
// Security – Herstellermeldungen (Fortinet, Microsoft, Synology …) mit CVEs
// =====================================================================
const SEC_KEY = 'sit-cockpit-security';
const SEC_STATUS = { new: 'Neu', progress: 'In Arbeit', done: 'Erledigt', irrelevant: 'Nicht relevant' };
const SEC_SEV = { critical: 'Kritisch', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' };
const SEC_SRC = { fortinet: 'Fortinet PSIRT', msrc: 'Microsoft', synology: 'Synology', nvd: 'NVD', kev: 'CISA KEV' };
function secPrefs() {
  const d = { days: 90, vendor: '', product: '', status: 'open', inUse: true, hot: false, q: '' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SEC_KEY) || '{}'), q: '' }; } catch { return d; }
}
const saveSecPrefs = (p) => { try { localStorage.setItem(SEC_KEY, JSON.stringify({ ...p, q: '' })); } catch { /* egal */ } };
const pctTxt = (x) => (x == null ? '–' : `${x < 0.001 ? '<0,1' : nf(Math.round(x * 1000) / 10)} %`);

async function renderSecurity({ refresh = false } = {}) {
  const seq = navSeq;
  const prefs = secPrefs();
  content.innerHTML = `<p class="loading">${refresh ? 'Rufe Hersteller-Feeds neu ab (bis zu einer Minute) …' : 'Lade Sicherheitsmeldungen …'}</p>`;
  let d;
  try { d = await api(`/security?days=${prefs.days}${refresh ? '&refresh=1' : ''}`); } catch (e) {
    if (stale(seq)) return;
    content.innerHTML = `<div class="banner crit"><div><b>Security-Meldungen nicht verfügbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (stale(seq)) return;
  const isOpen = (i) => ['new', 'progress'].includes(i.status.status);
  const vendors = [...new Set(d.items.map((i) => i.vendor))].sort();
  const failed = d.sources.filter((s) => s.error);
  const openUse = d.items.filter((i) => i.inUse && isOpen(i));
  const exploited = openUse.filter((i) => i.exploited);
  const affectedCustomers = new Set(openUse.filter((i) => i.exploited || i.severity === 'critical').flatMap((i) => i.customers.map((c) => c.id)));
  const nb = $('#nav-security');
  if (nb) { nb.hidden = !exploited.length; nb.textContent = exploited.length; }

  content.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Herstellermeldungen · CISA KEV · NVD · EPSS</div><h1>Security</h1></div>
      <div class="page-actions"><span class="stamp">Feeds: ${d.fetchedAt ? dateTime(d.fetchedAt) : 'noch nicht abgerufen'}${d.loading ? ' · lädt …' : ''}</span><button class="btn" id="sec-refresh" type="button">Neu abrufen</button></div>
    </div>
    ${failed.length ? `<div class="banner warn"><div><b>Nicht alle Quellen erreichbar</b>${failed.map((s) => `${esc(s.label)}: ${esc(s.error)}`).join(' · ')} – angezeigt wird der letzte Stand.</div></div>` : ''}
    ${d.ateraError ? `<div class="banner info"><div><b>Kundenabgleich eingeschränkt</b>Atera: ${esc(d.ateraError)} – betroffene Kunden können fehlen.</div></div>` : ''}
    <section class="kpis">
      <div class="kpi ${exploited.length ? 'crit' : ''}"><div class="label">Aktiv ausgenutzt, offen</div><div class="value">${exploited.length}</div><div class="sub">laut CISA KEV bzw. Hersteller · bei uns im Einsatz</div></div>
      <div class="kpi"><div class="label">Kritisch, offen</div><div class="value">${openUse.filter((i) => i.severity === 'critical').length}</div><div class="sub">CVSS ≥ 9 bzw. Hersteller „kritisch“</div></div>
      <div class="kpi"><div class="label">Betroffene Kunden</div><div class="value">${affectedCustomers.size}</div><div class="sub">bei kritischen / ausgenutzten Meldungen</div></div>
      <div class="kpi"><div class="label">Neu in 7 Tagen</div><div class="value">${d.items.filter((i) => i.inUse && (i.published || 0) > Date.now() - 7 * 864e5).length}</div><div class="sub">im Einsatz</div></div>
      <div class="kpi"><div class="label">Erledigt</div><div class="value">${d.items.filter((i) => i.status.status === 'done').length}</div><div class="sub">im gewählten Zeitraum</div></div>
    </section>
    <div class="card">
      <div class="card-head"><h2>Unsere Produkte</h2><span class="muted small">Geräte aus Atera · Liste in config/security.json · anklicken zum Filtern</span></div>
      <div class="table-wrap"><table class="sec-products"><thead><tr><th>Produkt</th><th>Hersteller</th><th class="num">Kunden</th><th class="num">Geräte</th><th class="num">offen</th><th class="num">ausgenutzt</th></tr></thead><tbody>
        ${d.products.filter((p) => p.inUse).sort((a, b) => b.exploited - a.exploited || b.open - a.open).map((p) => `<tr data-product="${esc(p.id)}" class="${prefs.product === p.id ? 'sel' : ''}">
          <td><b>${esc(p.label)}</b>${p.fromAtera ? '' : ' <span class="muted small">laut Liste</span>'}</td><td>${esc(p.vendor)}</td>
          <td class="num" title="${esc(p.customerList.map((c) => c.name).join(', '))}">${p.fromAtera ? p.customers : '–'}</td><td class="num">${p.fromAtera ? p.devices : '–'}</td>
          <td class="num">${p.open}</td><td class="num">${p.exploited ? chip('critical', String(p.exploited)) : '0'}</td></tr>`).join('')}
      </tbody></table></div>
      ${d.products.some((p) => !p.inUse) ? `<p class="muted small" style="margin:8px 0 0">Nicht im Einsatz erkannt: ${d.products.filter((p) => !p.inUse).map((p) => esc(p.label)).join(', ')} – erscheinen bei „auch nicht eingesetzte Produkte“.</p>` : ''}
    </div>
    <form class="toolbar sec-filter" id="sec-form" style="margin-top:18px" onsubmit="return false">
      <input class="search" type="search" name="q" placeholder="Suche: CVE, Produkt, Titel, Kunde …" aria-label="Meldungen durchsuchen">
      <div class="seg" role="group" aria-label="Zeitraum">${[30, 90, 365].map((x) => `<button type="button" data-days="${x}" aria-pressed="${x === d.days}">${x} Tage</button>`).join('')}</div>
      <select name="vendor" aria-label="Hersteller"><option value="">Alle Hersteller</option>${vendors.map((v) => `<option${v === prefs.vendor ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <select name="status" aria-label="Status"><option value="open"${prefs.status === 'open' ? ' selected' : ''}>Offen (neu + in Arbeit)</option><option value=""${prefs.status === '' ? ' selected' : ''}>Alle Status</option>${Object.entries(SEC_STATUS).map(([k, l]) => `<option value="${k}"${prefs.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="hot"${prefs.hot ? ' checked' : ''}> nur ausgenutzt / kritisch</label>
      <label class="check"><input type="checkbox" name="all"${prefs.inUse ? '' : ' checked'}> auch nicht eingesetzte Produkte</label>
      ${prefs.product ? `<button class="btn small" type="button" id="sec-clear-product">Produktfilter: ${esc(d.products.find((p) => p.id === prefs.product)?.label || prefs.product)} ✕</button>` : ''}
    </form>
    <div id="sec-list"></div>
    <p class="muted small" style="margin-top:14px">Quellen: ${d.sources.map((s) => `${esc(s.label)} ${s.error ? '(Fehler)' : s.count != null ? `(${nf(s.count)})` : ''}`).join(' · ')}. Atera kennt die Firmware-Versionen nicht – „betroffen“ heißt: Kunde setzt das Produkt ein, Version prüfen. EPSS = Wahrscheinlichkeit einer Ausnutzung in den nächsten 30 Tagen.</p>`;

  let shown = 50;
  const filtered = () => {
    const q = prefs.q.trim().toLowerCase();
    return d.items.filter((i) => (!prefs.inUse || i.inUse)
      && (!prefs.vendor || i.vendor === prefs.vendor)
      && (!prefs.product || i.productId === prefs.product)
      && (prefs.status === '' || (prefs.status === 'open' ? isOpen(i) : i.status.status === prefs.status))
      && (!prefs.hot || i.exploited || i.severity === 'critical')
      && (!q || `${i.title} ${i.summary} ${i.cves.join(' ')} ${i.productLabel} ${i.vendor} ${i.id} ${i.customers.map((c) => c.name).join(' ')}`.toLowerCase().includes(q)));
  };
  const itemHtml = (i) => {
    const cves = i.cves.slice(0, 4).map((c) => `<a href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c)}" target="_blank" rel="noopener">${esc(c)}</a>`).join(', ') + (i.cves.length > 4 ? ` <span class="muted">+${i.cves.length - 4}</span>` : '');
    const sevChip = i.severity ? chip(i.severity === 'critical' ? 'warning' : 'neutral', `${SEC_SEV[i.severity]}${i.cvss != null ? ` ${nf(i.cvss)}` : ''}`) : (i.cvss != null ? chip('neutral', `CVSS ${nf(i.cvss)}`) : '');
    const st = i.status;
    return `<article class="sec-item ${i.exploited ? 'exploited' : i.severity === 'critical' ? 'critical' : ''} ${isOpen(i) ? '' : 'closed'}" data-key="${esc(i.key)}">
      <div class="sec-top">
        ${i.exploited ? chip('critical', 'Aktiv ausgenutzt') : ''}${i.kev?.ransomware ? chip('critical', 'Ransomware') : ''}${sevChip}
        <span class="sec-prod">${esc(i.vendor)} · ${esc(i.productLabel)}</span>
        <span class="muted small sec-date">${date(i.published)}${i.updated && i.updated - (i.published || 0) > 864e5 ? ` · aktualisiert ${date(i.updated)}` : ''} · ${esc(SEC_SRC[i.source] || i.source)}</span>
      </div>
      <h3 class="sec-title"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      ${i.summary && !i.summary.startsWith(i.title.replace(/[.…]+$/, '')) ? `<p class="sec-sum">${esc(i.summary)}</p>` : ''}
      <div class="sec-meta">
        ${i.cves.length ? `<span>${cves}</span>` : ''}
        ${i.epss != null ? `<span title="Wahrscheinlichkeit einer Ausnutzung in 30 Tagen (FIRST EPSS)">EPSS ${pctTxt(i.epss)}</span>` : ''}
        ${i.kev?.due ? `<span>CISA-Frist ${date(i.kev.due)}</span>` : ''}
        <span>${i.customers.length ? `<b>${plural(i.customers.length, 'Kunde', 'Kunden')} betroffen</b>` : i.inUse ? 'im Einsatz (nicht in Atera erfasst)' : '<span class="muted">bei uns nicht erkannt</span>'}</span>
      </div>
      <details class="sec-details"><summary>Details${i.customers.length ? ', betroffene Kunden' : ''}${i.fix?.length ? ', Lösung' : ''}</summary>
        ${i.customers.length ? `<div class="sec-block"><b>Betroffene Kunden</b><ul class="sec-cust">${i.customers.map((c) => `<li><a href="#/kunden/${encodeURIComponent(c.id)}">${esc(c.name)}</a> <span class="muted small">${plural(c.devices, 'Gerät', 'Geräte')}</span>${c.ticket ? ` <span class="chip neutral" title="angelegt von ${esc(c.ticket.by)} am ${date(c.ticket.at)}">Ticket ${esc(c.ticket.number)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
        ${i.affected?.length ? `<div class="sec-block"><b>Betroffene Versionen</b><ul>${i.affected.map((a) => `<li>${esc(a.replace('|', ' bis '))}</li>`).join('')}</ul></div>` : ''}
        ${i.fix?.length ? `<div class="sec-block"><b>Lösung</b><ul>${i.fix.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
        ${i.products?.length && i.source !== 'kev' ? `<div class="sec-block"><b>Produkte</b> <span class="muted">${esc(i.products.slice(0, 12).join(', '))}</span></div>` : ''}
        ${i.details?.length ? `<div class="sec-block"><b>Lücken</b><div class="table-wrap"><table><tbody>${i.details.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.cve)}</a></td><td class="wrap">${esc(x.title)}</td><td>${x.exploited ? chip('critical', 'ausgenutzt') : x.disclosed ? chip('neutral', 'öffentlich') : ''}</td><td class="num">${x.cvss != null ? nf(x.cvss) : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        ${i.kev?.action ? `<div class="sec-block"><b>CISA-Empfehlung</b> <span class="muted">${esc(i.kev.action)}</span></div>` : ''}
      </details>
      <div class="sec-status">
        <select data-status aria-label="Bearbeitungsstatus">${Object.entries(SEC_STATUS).map(([k, l]) => `<option value="${k}"${st.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input data-note type="text" maxlength="500" placeholder="Notiz: was wurde gemacht, welche Kunden sind offen …" value="${esc(st.note || '')}" aria-label="Notiz">
        <span class="muted small">${st.by ? `${esc(st.by)}, ${dateTime(st.at)}` : ''}</span>
        ${i.customers.length ? (() => { const done = i.customers.filter((c) => c.ticket).length; return `<button class="btn small sec-tk" type="button" data-tickets>${done === i.customers.length ? `Tickets: ${done}/${done}` : done ? `Tickets anlegen (${done}/${i.customers.length} vorhanden)` : `Tickets anlegen (${i.customers.length})`}</button>`; })() : ''}
      </div>
    </article>`;
  };
  const draw = () => {
    const rows = filtered();
    $('#sec-list').innerHTML = rows.length
      ? `<p class="muted small" style="margin:0 0 8px">${plural(rows.length, 'Meldung', 'Meldungen')} · wichtigste zuerst (aktiv ausgenutzt, Schweregrad, EPSS)</p>${rows.slice(0, shown).map(itemHtml).join('')}${rows.length > shown ? `<button class="btn" id="sec-more" type="button" style="margin-top:10px">Weitere ${Math.min(50, rows.length - shown)} anzeigen</button>` : ''}`
      : `<div class="banner ok"><div><b>Nichts offen</b>Für diese Auswahl gibt es keine Meldungen${prefs.status === 'open' ? ', die noch bearbeitet werden müssen' : ''}.</div></div>`;
    const more = $('#sec-more');
    if (more) more.onclick = () => { shown += 50; draw(); };
    $$('#sec-list .sec-item').forEach((el) => {
      const key = el.dataset.key;
      const item = d.items.find((x) => x.key === key);
      const save = async () => {
        const status = el.querySelector('[data-status]').value, note = el.querySelector('[data-note]').value;
        if (status === item.status.status && note === (item.status.note || '')) return;
        try {
          item.status = await api('/security/status', { method: 'PUT', body: { key, status, note } });
          toast(`Status: ${SEC_STATUS[status]}`);
          el.querySelector('.sec-status .muted').textContent = `${item.status.by}, ${dateTime(item.status.at)}`;
          el.classList.toggle('closed', !isOpen(item));
        } catch (e) { toast(e.message, true); }
      };
      el.querySelector('[data-status]').onchange = save;
      el.querySelector('[data-note]').onchange = save;
      const tk = el.querySelector('[data-tickets]');
      if (tk) tk.onclick = () => openSecurityTicketDialog(item, () => renderSecurity());
    });
  };
  draw();

  const form = $('#sec-form');
  form.q.oninput = () => { prefs.q = form.q.value; shown = 50; draw(); };
  form.vendor.onchange = () => { prefs.vendor = form.vendor.value; saveSecPrefs(prefs); shown = 50; draw(); };
  form.status.onchange = () => { prefs.status = form.status.value; saveSecPrefs(prefs); shown = 50; draw(); };
  form.hot.onchange = () => { prefs.hot = form.hot.checked; saveSecPrefs(prefs); shown = 50; draw(); };
  form.all.onchange = () => { prefs.inUse = !form.all.checked; saveSecPrefs(prefs); shown = 50; draw(); };
  $$('#sec-form [data-days]').forEach((b) => (b.onclick = () => { prefs.days = Number(b.dataset.days); saveSecPrefs(prefs); renderSecurity(); }));
  $$('.sec-products tr[data-product]').forEach((tr) => (tr.onclick = () => { prefs.product = prefs.product === tr.dataset.product ? '' : tr.dataset.product; saveSecPrefs(prefs); renderSecurity(); }));
  const clr = $('#sec-clear-product');
  if (clr) clr.onclick = () => { prefs.product = ''; saveSecPrefs(prefs); renderSecurity(); };
  $('#sec-refresh').onclick = () => renderSecurity({ refresh: true });
}

// ---------- Tickets aus einer Security-Meldung (je betroffenem Kunden eines) ----------
async function openSecurityTicketDialog(item, onDone) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="stk-title"><p class="loading">Suche weclapp-Kunden und Ticket-Stammdaten …</p></div>';
  document.body.append(back);
  const modal = back.querySelector('.modal');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  let meta, prep;
  try {
    [meta, prep] = await Promise.all([api('/atera-tickets/meta'), api(`/security/tickets?key=${encodeURIComponent(item.key)}`)]);
  } catch (e) {
    modal.innerHTML = `<div class="banner crit"><div><b>weclapp nicht erreichbar</b>${esc(e.message)}</div></div><button class="btn" type="button" data-close>Schließen</button>`;
    modal.querySelector('[data-close]').onclick = close;
    return;
  }
  const cves = item.cves.slice(0, 10).join(', ') + (item.cves.length > 10 ? ` (+${item.cves.length - 10})` : '');
  const subject = `Security: ${item.vendor} – ${item.title}`.slice(0, 150);
  const lines = [
    `Sicherheitsmeldung: ${item.title}`,
    `Hersteller/Produkt: ${item.vendor} · ${item.productLabel}`,
    item.exploited ? `ACHTUNG: wird aktiv ausgenutzt${item.kev?.ransomware ? ' (auch durch Ransomware)' : ''}${item.kev?.due ? ` · CISA-Frist ${date(item.kev.due)}` : ''}` : null,
    item.severity ? `Schweregrad: ${SEC_SEV[item.severity]}${item.cvss != null ? ` (CVSS ${nf(item.cvss)})` : ''}` : null,
    cves ? `CVE: ${cves}` : null,
    item.affected?.length ? `Betroffene Versionen:\n${item.affected.map((a) => `- ${a.replace('|', ' bis ')}`).join('\n')}` : null,
    item.fix?.length ? `Lösung:\n${item.fix.map((a) => `- ${a}`).join('\n')}` : null,
    `Hersteller-Info: ${item.url}`,
    '',
    'Aufgabe: installierte Version prüfen und, falls betroffen, Update einspielen bzw. Workaround umsetzen.',
  ].filter((x) => x != null).join('\n');
  const prio = item.exploited || item.severity === 'critical' ? meta.defaults.priorityCritical : meta.defaults.priorityWarning;
  const opt = (list, sel) => list.map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const can = (c) => c.party && !c.ticket;
  const custRow = (c) => `<li><label class="check"><input type="checkbox" value="${esc(c.id)}"${can(c) ? ' checked' : ' disabled'}>
    <span><b>${esc(c.name)}</b>${c.party?.number ? ` <span class="muted small">${esc(c.party.number)}</span>` : ''}
    ${c.ticket ? ` <span class="chip neutral">Ticket ${esc(c.ticket.number)}</span>` : !c.party ? ' <span class="chip warning">kein weclapp-Kunde</span>' : ''}
    ${c.devices.length ? `<br><span class="muted small">${esc(c.devices.slice(0, 6).join(', '))}${c.devices.length > 6 ? ` +${c.devices.length - 6}` : ''}</span>` : ''}</span></label></li>`;
  const missing = prep.customers.filter((c) => !c.party && !c.ticket).length;
  modal.innerHTML = `
    <h2 id="stk-title" style="margin-bottom:4px">Tickets anlegen</h2>
    <p class="muted" style="margin:0 0 14px">${esc(item.vendor)} · ${esc(item.title)}<br>Je ausgewähltem Kunden ein Ticket in weclapp, die betroffenen Geräte aus Atera werden ergänzt.</p>
    ${missing ? `<div class="banner info"><div><b>${plural(missing, 'Kunde', 'Kunden')} ohne weclapp-Zuordnung</b>Unter <a href="#/zuordnung">Kundenzuordnung</a> verknüpfen, dann lassen sich auch dafür Tickets anlegen.</div></div>` : ''}
    <form id="stk-form">
      <div class="field"><label>Kunden <span class="muted small" id="stk-count"></span> <button class="btn small ghost" type="button" id="stk-all">alle / keine</button></label><ul class="stk-cust">${prep.customers.map(custRow).join('')}</ul></div>
      <div class="field"><label for="stk-subject">Betreff</label><input id="stk-subject" maxlength="150" required value="${esc(subject)}"></div>
      <div class="field"><label for="stk-desc">Beschreibung</label><textarea id="stk-desc" rows="9">${esc(lines)}</textarea></div>
      <div class="grid-2" style="gap:0 14px">
        <div class="field"><label for="stk-prio">Priorität</label><select id="stk-prio">${opt(meta.priorities, prio)}</select></div>
        <div class="field"><label for="stk-user">Bearbeiter</label><select id="stk-user"><option value="">– niemand –</option>${opt(meta.users, meta.defaults.assignedUserId)}</select></div>
        <div class="field"><label for="stk-status">Status</label><select id="stk-status">${opt(meta.statuses, meta.defaults.statusId)}</select></div>
        <div class="field"><label for="stk-channel">Kanal</label><select id="stk-channel">${opt(meta.channels, meta.defaults.channelId)}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="stk-notify"><span>Kunden per E-Mail über das neue Ticket informieren (weclapp-Vorlage)</span></label>
      <div id="stk-result" role="status"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" type="button" data-close>Abbrechen</button><button class="btn primary" type="submit" id="stk-submit">Tickets anlegen</button></div>
    </form>`;
  const boxes = () => [...modal.querySelectorAll('.stk-cust input:not(:disabled)')];
  const btn = modal.querySelector('#stk-submit');
  const count = () => { const n = boxes().filter((b) => b.checked).length; modal.querySelector('#stk-count').textContent = `(${n} ausgewählt)`; btn.disabled = !n; btn.textContent = n ? `${plural(n, 'Ticket', 'Tickets')} anlegen` : 'Tickets anlegen'; };
  boxes().forEach((b) => (b.onchange = count));
  modal.querySelector('#stk-all').onclick = () => { const on = !boxes().every((b) => b.checked); boxes().forEach((b) => (b.checked = on)); count(); };
  count();
  modal.querySelector('[data-close]').onclick = close;
  modal.querySelector('#stk-form').onsubmit = async (e) => {
    e.preventDefault();
    const ids = boxes().filter((b) => b.checked).map((b) => b.value);
    btn.disabled = true; btn.textContent = 'Wird angelegt …';
    try {
      const r = await api('/security/tickets', { method: 'POST', body: {
        key: item.key, customerIds: ids,
        subject: modal.querySelector('#stk-subject').value,
        description: modal.querySelector('#stk-desc').value,
        priorityId: modal.querySelector('#stk-prio').value,
        assignedUserId: modal.querySelector('#stk-user').value,
        statusId: modal.querySelector('#stk-status').value,
        channelId: modal.querySelector('#stk-channel').value,
        notifyCustomer: modal.querySelector('#stk-notify').checked,
      } });
      const bad = r.results.filter((x) => !x.ticket);
      if (!bad.length) { close(); toast(`${plural(r.created, 'Ticket', 'Tickets')} angelegt`); onDone?.(); return; }
      modal.querySelector('#stk-result').innerHTML = `<div class="banner ${r.created ? 'warn' : 'crit'}"><div><b>${r.created} angelegt, ${bad.length} nicht</b>${r.results.map((x) => `${esc(x.name)}: ${x.ticket ? `Ticket ${esc(x.ticket.number)}` : esc(x.error || x.skipped)}`).join('<br>')}</div></div>`;
      btn.textContent = 'Fertig'; btn.disabled = false;
      btn.onclick = (ev) => { ev.preventDefault(); close(); onDone?.(); };
    } catch (ex) {
      modal.querySelector('#stk-result').innerHTML = `<p class="error" role="alert">${esc(ex.message)}</p>`;
      count();
    }
  };
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
// SIT-Time läuft als eigene App (time.schwaiger-it.at) und wird hier nur angezeigt: immer aktuell,
// dieselben Timer wie am Handy. Die Microsoft-Anmeldung lässt sich nicht einbetten – meldet sich
// SIT-Time nicht, öffnet "Bei SIT-Time anmelden" sie kurz in einem Popup.
let timeMsg = null;
function timeFetch(path) {
  const url = state.me?.links?.time;
  if (!url) return Promise.reject(new Error('SIT-Time nicht konfiguriert'));
  return fetch(`${url}/api${path}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`SIT-Time ${r.status}`))));
}
function renderTime() {
  const url = state.me?.links?.time;
  if (!url) { content.innerHTML = '<div class="banner warn"><div><b>SIT-Time nicht konfiguriert</b>TIME_URL fehlt in der Cockpit-Konfiguration.</div></div>'; return; }
  const origin = new URL(url).origin;
  const seq = navSeq;
  content.innerHTML = `<div class="time-wrap">
    <iframe class="time-frame" src="${esc(url)}/" title="SIT-Time Zeiterfassung" allow="camera; clipboard-write"></iframe>
    <div class="time-overlay" hidden><div class="card">
      <h2>SIT-Time meldet sich nicht</h2>
      <p class="muted">Meist ist die Microsoft-Anmeldung von SIT-Time abgelaufen. Sie lässt sich nicht im Cockpit anzeigen – ein kleines Fenster öffnet sie, danach geht es hier weiter.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" type="button" data-time-login>Bei SIT-Time anmelden</button><a class="btn ghost" href="${esc(url)}/" target="_blank" rel="noopener">In eigenem Tab öffnen</a></div>
    </div></div></div>`;
  const frame = content.querySelector('.time-frame');
  const overlay = content.querySelector('.time-overlay');
  let alive = false;
  if (timeMsg) window.removeEventListener('message', timeMsg);
  timeMsg = (e) => {
    if (e.origin !== origin || e.data?.type !== 'sit-time') return;
    if (e.data.state === 'ready' || e.data.state === 'login') { alive = true; overlay.hidden = true; }
    if (e.data.state === 'auth-ok') { overlay.hidden = true; frame.src = `${url}/`; }
  };
  window.addEventListener('message', timeMsg);
  setTimeout(() => { if (!alive && !stale(seq)) overlay.hidden = false; }, 8000);
  content.querySelector('[data-time-login]').onclick = () => window.open(`${url}/?popup=1`, 'sit-time-login', 'width=520,height=680');
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
