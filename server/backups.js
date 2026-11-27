// Backup-Übersicht: Sicherungsereignisse aus Atera, als Wochentabelle je Kunde.
//
// Quelle sind die Atera-Alerts aus der Ereignisprotokoll-Überwachung, z. B.
//   Titel   "Ereignisprotokoll: Veeam Backup | Ereignis-ID: 190"
//   Meldung "Backup job 'Backup Job NAS' finished with Failed.\nJob details: …\n[Maschinenname: SRV01]"
// Atera liefert die Historie (alle Status, neueste zuerst). Die Backup-Ereignisse werden in
// DATA_DIR/backup-events.json gesammelt, damit nicht jedes Mal Wochen an Alerts gelesen werden.
//
// Status je Kunde und Tag (Tag = Sicherungsnacht: Ereignisse vor BACKUP_DAY_CUTOFF_HOUR Uhr
// zählen zum Vortag):
//   failed   letztes Ergebnis eines Jobs an dem Tag "Failed" (ein erfolgreicher Retry hebt es auf)
//   warning  letztes Ergebnis "Warning"
//   success  Erfolg gemeldet (nur wenn die Atera-Überwachung auch Erfolge meldet)
//   quiet    keine Meldung – bei Überwachung nur auf Fehler heißt das: kein Fehler gemeldet
//   missing  keine Meldung, obwohl der Kunde sonst Erfolge meldet (Sicherung lief evtl. nicht)
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as atera from './atera.js';

const D = 864e5;
const MAX_WEEKS = 8;
const TZ = 'Europe/Vienna';
const file = () => path.join(config.dataDir, 'backup-events.json');
const cutoff = () => config.backupDayCutoffHour;

// ---------------------------------------------------------------- Ereignis lesen
const TITLE_RE = /^(?:Ereignisprotokoll|Event ?Log)\s*:\s*(.+?)\s*\|\s*(?:Ereignis-ID|Event ?ID)\s*:\s*(\d+)/i;
export const isBackupEvent = (a) => atera.isBackupAlert(a) || /veeam|backup|sicherung/i.test(`${a.Title || ''}`);

export function parseEvent(a) {
  const msg = String(a.AlertMessage || '').replace(/\r\n/g, '\n').trim();
  const t = String(a.Title || '');
  const m = t.match(TITLE_RE);
  const machine = msg.match(/\[(?:Maschinenname|Machine ?name)\s*:\s*([^\]]+)\]/i)?.[1]?.trim();
  const text = msg.replace(/\n?\[(?:Maschinenname|Machine ?name)\s*:[^\]]+\]\s*$/i, '').trim();
  const lower = `${t} ${msg}`.toLowerCase();
  const fin = msg.match(/finished with (success|warning|failed)/i)?.[1]?.toLowerCase();
  const result = fin === 'failed' ? 'failed' : fin === 'warning' ? 'warning' : fin === 'success' ? 'success'
    : /\b(erfolgreich|successfully|succeeded)\b/.test(lower) && !/nicht erfolgreich|not successful/.test(lower) ? 'success'
      : /\b(fehlgeschlagen|failed|fehler|error)\b/.test(lower) ? 'failed'
        : /\bwarn/.test(lower) ? 'warning'
          : /crit/i.test(a.Severity) ? 'failed' : /warn/i.test(a.Severity) ? 'warning' : 'info';
  return {
    id: String(a.AlertID),
    customerId: a.CustomerID != null ? String(a.CustomerID) : '',
    customer: a.CustomerName || '',
    device: machine || a.DeviceName || '',
    deviceGuid: a.DeviceGuid || '',
    at: atera.ts(a.Created),
    title: t,
    source: m ? m[1] : (a.Source || ''),
    eventId: m ? m[2] : null,
    severity: a.Severity || '',
    result,
    job: msg.match(/job ['"„]([^'"“]+)['"“]/i)?.[1] || null,
    retry: /^retry\b|wiederholung/i.test(msg),
    summary: (text.split('\n')[0] || t).slice(0, 200),
    text,
    open: !a.Archived,
  };
}

// ---------------------------------------------------------------- Tage
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Sicherungstag (YYYY-MM-DD, Wiener Zeit; vor dem Stichzeitpunkt zählt zum Vortag) */
export const dayKey = (ms, hour = cutoff()) => fmt.format(new Date(ms - hour * 3600e3));
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * D).toISOString().slice(0, 10);
const weekday = (key) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Montag

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
/** letzte abgeschlossene Sicherungsnacht: vor dem Stichzeitpunkt die Nacht auf heute, danach ebenso (heute Nacht läuft noch) */
export function lastNight(now = Date.now(), hour = cutoff()) {
  const k = dayKey(now, hour);
  return Number(hourFmt.format(new Date(now))) >= hour ? addDays(k, -1) : k;
}

/** sieben Tage (Mo–So) der Woche mit Versatz (0 = aktuelle Woche, -1 = Vorwoche …) */
export function weekDays(offset = 0, now = Date.now()) {
  const today = dayKey(now, 0);
  const monday = addDays(today, -weekday(today) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// ---------------------------------------------------------------- Speicher + Abruf
let store = null; // { events: {id: ev}, coveredFrom, syncedAt }
let loading = null;
let lastError = null;
function loadStore() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { store = { events: {}, coveredFrom: null, syncedAt: 0 }; }
  return store;
}
function saveStore() {
  const keep = Date.now() - (MAX_WEEKS + 1) * 7 * D;
  store.events = Object.fromEntries(Object.entries(store.events).filter(([, e]) => (e.at || 0) >= keep));
  if (store.coveredFrom && store.coveredFrom < keep) store.coveredFrom = keep;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify(store));
  fs.renameSync(`${file()}.tmp`, file());
}

/** Alerts seitenweise (neueste zuerst) lesen, bis "from" erreicht ist */
export function sync(from) {
  if (loading) return loading;
  const s = loadStore();
  loading = (async () => {
    const extendBack = !s.coveredFrom || from < s.coveredFrom;
    // nur Neues holen, wenn der Zeitraum schon abgedeckt ist (2 Std. Überlappung)
    const stopAt = extendBack ? from : Math.max(from, (s.syncedAt || 0) - 2 * 3600e3);
    const started = Date.now();
    for (let page = 1; page <= 200; page++) {
      const d = await atera.alertsPage(page);
      const items = d.items || [];
      for (const a of items) if (isBackupEvent(a)) { const e = parseEvent(a); s.events[e.id] = e; }
      const oldest = Math.min(...items.map((a) => atera.ts(a.Created) || Infinity));
      if (!items.length || oldest < stopAt || page >= (d.totalPages || 0)) break;
    }
    if (extendBack) s.coveredFrom = from;
    s.syncedAt = started;
    saveStore();
    lastError = null;
  })().catch((e) => { lastError = e.message; console.error('Backup-Abruf:', e.message); })
    .finally(() => { loading = null; });
  return loading;
}

// ---------------------------------------------------------------- Auswertung
const RANK = { failed: 3, warning: 2, success: 1 };
/** Tagesstatus aus den Ereignissen eines Kunden an einem Tag (letztes Ergebnis je Job zählt) */
export function dayStatus(events) {
  const jobs = new Map();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.result === 'info') continue;
    jobs.set(`${e.device}|${e.job || e.title}`, e.result);
  }
  let worst = null;
  for (const r of jobs.values()) if (!worst || RANK[r] > RANK[worst]) worst = r;
  return worst;
}

export async function backupReport({ week = 0, force = false, now = Date.now() } = {}) {
  week = Math.max(-(MAX_WEEKS - 1), Math.min(0, Math.trunc(Number(week) || 0)));
  const days = weekDays(week, now);
  const from = Date.parse(`${days[0]}T00:00:00Z`) - 2 * 3600e3; // Montag (Wiener Zeit, großzügig)
  const s = loadStore();
  const stale = now - (s.syncedAt || 0) > config.backupRefreshMinutes * 60e3;
  if (force || !s.coveredFrom || from < s.coveredFrom) {
    await Promise.race([sync(from), new Promise((r) => setTimeout(r, 25000).unref())]);
  } else if (stale) sync(from);

  const ov = await atera.overview().catch(() => ({ customers: [] }));
  const custs = new Map((ov.customers || []).map((c) => [String(c.id), { id: String(c.id), name: c.name, paused: c.paused || null }]));
  const evs = Object.values(s.events);
  for (const e of evs) if (e.customerId && !custs.has(e.customerId)) custs.set(e.customerId, { id: e.customerId, name: e.customer || `Kunde ${e.customerId}`, paused: null });

  // Kunden, deren Überwachung Erfolge meldet (in den gespeicherten Wochen)
  const reportsSuccess = new Set(evs.filter((e) => e.result === 'success').map((e) => e.customerId));
  const last = lastNight(now); // letzte abgeschlossene Sicherungsnacht
  const inWeek = new Set(days);
  const byCust = new Map();
  for (const e of evs) {
    const k = dayKey(e.at);
    if (!inWeek.has(k)) continue;
    if (!byCust.has(e.customerId)) byCust.set(e.customerId, new Map());
    const m = byCust.get(e.customerId);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }

  const customers = [...custs.values()].map((c) => {
    const m = byCust.get(c.id) || new Map();
    const cells = days.map((k) => {
      const events = (m.get(k) || []).sort((a, b) => b.at - a.at);
      let status = dayStatus(events);
      if (!status) status = k > last ? 'future' : reportsSuccess.has(c.id) ? 'missing' : 'quiet';
      return { day: k, status, events: events.map(({ customerId, customer, ...e }) => e) };
    });
    const count = (st) => cells.filter((x) => x.status === st).length;
    return {
      ...c, cells, failed: count('failed'), warnings: count('warning'), missing: count('missing'), successes: count('success'),
      reportsSuccess: reportsSuccess.has(c.id),
      lastFailure: evs.filter((e) => e.customerId === c.id && e.result === 'failed').reduce((mx, e) => Math.max(mx, e.at), 0) || null,
    };
  }).sort((a, b) => b.failed - a.failed || b.warnings - a.warnings || b.missing - a.missing || a.name.localeCompare(b.name, 'de'));

  const calendarToday = dayKey(now, 0);
  return {
    week, days: days.map((k) => ({ key: k, weekday: weekday(k), today: k === calendarToday, lastNight: k === last, future: k > last })),
    cutoffHour: cutoff(),
    customers,
    totals: {
      customersFailed: customers.filter((c) => c.failed).length,
      failedCells: customers.reduce((x, c) => x + c.failed, 0),
      lastNightFailed: inWeek.has(last) ? customers.filter((c) => c.cells.find((x) => x.day === last)?.status === 'failed').length : null,
      lastNight: last,
      reportingSuccess: customers.filter((c) => c.reportsSuccess).length,
      events: customers.reduce((x, c) => x + c.cells.reduce((y, d) => y + d.events.length, 0), 0),
    },
    successSeen: reportsSuccess.size > 0,
    syncedAt: s.syncedAt || null, coveredFrom: s.coveredFrom || null,
    loading: Boolean(loading), error: lastError || ov.error || null,
  };
}

export function startBackgroundRefresh() {
  const tick = () => sync(Date.now() - 14 * D).catch(() => {});
  setTimeout(tick, 15000).unref();
  setInterval(tick, config.backupRefreshMinutes * 60e3).unref();
}
