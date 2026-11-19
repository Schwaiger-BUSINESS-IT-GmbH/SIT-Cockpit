// Arbeitszeit & Abwesenheiten pro weclapp-User (JSON-Datei, wie die Ticket-Timer).
// Tage werden in Europe/Vienna gerechnet (Server läuft in Azure auf UTC).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const TZ = 'Europe/Vienna';
const file = path.join(config.dataDir, 'worktime.json');
fs.mkdirSync(config.dataDir, { recursive: true });

let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* neu */ }

let writing = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writing = writing.then(async () => {
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, file);
  }).catch((e) => console.error('Arbeitszeit speichern fehlgeschlagen:', e));
  return writing;
}

export const ABSENCE_TYPES = {
  urlaub: { label: 'Urlaub', credit: true },
  krank: { label: 'Krankenstand', credit: true },
  za: { label: 'Zeitausgleich', credit: false }, // baut Überstunden ab
  sonstiges: { label: 'Sonstiges', credit: true },
};

const DEFAULT_SETTINGS = {
  weeklyHours: 38.5,
  workdays: [1, 2, 3, 4, 5], // 0 = So … 6 = Sa
  vacationDays: 25,
  vacationCarry: 0,          // Resturlaub-Übertrag ins laufende Jahr
  startBalanceMin: 0,        // Überstunden-Saldo zum Startdatum
  startDate: null,           // ab wann Soll/Ist gerechnet wird
};

// ---------- Datum-Helfer ----------
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (ms) => dayFmt.format(new Date(ms)); // 'YYYY-MM-DD'
const toUTC = (d) => new Date(d + 'T12:00:00Z');
const weekday = (d) => toUTC(d).getUTCDay();
function addDays(d, n) {
  const x = toUTC(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function mondayOf(d) {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
function* eachDay(from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

// Gesetzliche Feiertage Österreich
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const holidayCache = new Map();
export function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easterSunday(y);
  const map = {
    [`${y}-01-01`]: 'Neujahr', [`${y}-01-06`]: 'Heilige Drei Könige',
    [addDays(e, 1)]: 'Ostermontag', [`${y}-05-01`]: 'Staatsfeiertag',
    [addDays(e, 39)]: 'Christi Himmelfahrt', [addDays(e, 50)]: 'Pfingstmontag',
    [addDays(e, 60)]: 'Fronleichnam', [`${y}-08-15`]: 'Mariä Himmelfahrt',
    [`${y}-10-26`]: 'Nationalfeiertag', [`${y}-11-01`]: 'Allerheiligen',
    [`${y}-12-08`]: 'Mariä Empfängnis', [`${y}-12-25`]: 'Christtag', [`${y}-12-26`]: 'Stefanitag',
  };
  holidayCache.set(y, map);
  return map;
}
const holidayName = (d) => holidays(Number(d.slice(0, 4)))[d] || null;

// ---------- Speicher ----------
function bucket(userId) {
  const key = String(userId);
  db.users[key] ??= { entries: [], absences: [], status: 'off', settings: {} };
  const b = db.users[key];
  b.settings = { ...DEFAULT_SETTINGS, ...b.settings };
  if (!b.settings.startDate) { b.settings.startDate = dayOf(Date.now()); persist(); }
  return b;
}

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Berechnung ----------
function sollMin(s, d) {
  if (d < s.startDate) return 0;
  if (!s.workdays.includes(weekday(d)) || holidayName(d)) return 0;
  return Math.round((s.weeklyHours * 60) / Math.max(1, s.workdays.length));
}
function absenceOn(b, d) {
  return b.absences.find((a) => a.from <= d && d <= a.to) || null;
}
function entriesOn(b, d) {
  return b.entries.filter((e) => dayOf(e.start) === d).sort((x, y) => x.start - y.start);
}
function dayInfo(b, d, now) {
  const s = b.settings;
  const entries = entriesOn(b, d);
  const istMin = Math.round(entries.reduce((sum, e) => sum + ((e.end ?? now) - e.start), 0) / 60000);
  let breakMin = 0;
  for (let i = 1; i < entries.length; i++) breakMin += Math.max(0, (entries[i].start - entries[i - 1].end) / 60000);
  if (b.status === 'break' && d === dayOf(now) && entries.length && entries.at(-1).end) {
    breakMin += (now - entries.at(-1).end) / 60000;
  }
  const soll = sollMin(s, d);
  const abs = absenceOn(b, d);
  let creditMin = 0;
  if (abs && soll && ABSENCE_TYPES[abs.type]?.credit) creditMin = Math.round(soll * (abs.half ? 0.5 : 1));
  return {
    date: d, weekday: weekday(d), holiday: holidayName(d), beforeStart: d < s.startDate,
    sollMin: soll, istMin, creditMin, breakMin: Math.round(breakMin),
    diffMin: istMin + creditMin - soll,
    absence: abs ? { id: abs.id, type: abs.type, label: ABSENCE_TYPES[abs.type]?.label, half: !!abs.half } : null,
    entries: entries.map((e) => ({ id: e.id, start: e.start, end: e.end })),
  };
}

// Urlaubstage einer Abwesenheit (nur Arbeitstage, ohne Feiertage), optional auf ein Jahr begrenzt
function absenceDays(s, a, year) {
  let n = 0;
  for (const d of eachDay(a.from, a.to)) {
    if (year && Number(d.slice(0, 4)) !== year) continue;
    if (s.workdays.includes(weekday(d)) && !holidayName(d)) n += a.half ? 0.5 : 1;
  }
  return n;
}

export function overview(userId, weekStart) {
  const b = bucket(userId);
  const s = b.settings;
  const now = Date.now();
  const today = dayOf(now);
  const monday = mondayOf(weekStart || today);

  // Saldo: Startsaldo + alle Tage vom Startdatum bis gestern
  let balance = s.startBalanceMin;
  for (const d of eachDay(s.startDate, addDays(today, -1))) balance += dayInfo(b, d, now).diffMin;

  const year = Number(today.slice(0, 4));
  const used = b.absences.filter((a) => a.type === 'urlaub').reduce((n, a) => n + absenceDays(s, a, year), 0);
  const planned = b.absences.filter((a) => a.type === 'urlaub' && a.to >= today)
    .reduce((n, a) => n + absenceDays(s, { ...a, from: a.from < today ? today : a.from }, year), 0);
  const entitlement = s.vacationDays + s.vacationCarry;

  const open = b.entries.find((e) => e.end == null);
  return {
    status: b.status,
    runningSince: open?.start ?? null,
    today: dayInfo(b, today, now),
    week: [...eachDay(monday, addDays(monday, 6))].map((d) => dayInfo(b, d, now)),
    weekStart: monday,
    balanceMin: Math.round(balance),
    vacation: { year, entitlement, used, planned, remaining: entitlement - used },
    absences: b.absences
      .filter((a) => a.to >= `${year - 1}-12-01`)
      .sort((x, y) => (x.from < y.from ? 1 : -1))
      .map((a) => ({ ...a, label: ABSENCE_TYPES[a.type]?.label, days: absenceDays(s, a) })),
    settings: s,
    types: Object.fromEntries(Object.entries(ABSENCE_TYPES).map(([k, v]) => [k, v.label])),
    serverNow: now,
  };
}

// ---------- Stempeluhr ----------
export async function clock(userId, action) {
  const b = bucket(userId);
  const now = Date.now();
  const open = b.entries.find((e) => e.end == null);
  if (action === 'in' || action === 'resume') {
    if (!open) b.entries.push({ id: crypto.randomUUID(), start: now, end: null });
    b.status = 'work';
  } else if (action === 'pause') {
    if (open) open.end = now;
    b.status = 'break';
  } else if (action === 'out') {
    if (open) open.end = now;
    b.status = 'off';
  } else {
    throw err('Unbekannte Aktion');
  }
  await persist();
}

// Lokalen Stand an die weclapp-Arbeitszeit (Quelle der Wahrheit) angleichen
export async function reconcile(userId, r) {
  if (!r || !r.state) return false;
  const b = bucket(userId);
  const now = Date.now();
  const open = b.entries.find((e) => e.end == null);
  const lastEnd = Math.max(0, ...b.entries.filter((e) => e.end).map((e) => e.end));
  const clamp = (t, min) => Math.min(now, Math.max(t || now, min || 0));
  let changed = false;
  if (r.state === 'work') {
    if (!open) {
      // Beginn: nach der letzten Pause bzw. Anmeldung in weclapp, aber nicht vor dem letzten lokalen Eintrag
      const start = clamp(r.breakEnd || r.start, lastEnd);
      b.entries.push({ id: crypto.randomUUID(), start, end: null, source: 'weclapp' });
      changed = true;
    }
    if (b.status !== 'work') { b.status = 'work'; changed = true; }
  } else if (r.state === 'break') {
    if (open) { open.end = clamp(r.breakStart, open.start + 1000); changed = true; }
    else if (!b.entries.some((e) => dayOf(e.start) === dayOf(now)) && r.start && r.breakStart && r.breakStart > r.start) {
      b.entries.push({ id: crypto.randomUUID(), start: r.start, end: r.breakStart, source: 'weclapp' });
      changed = true;
    }
    if (b.status !== 'break') { b.status = 'break'; changed = true; }
  } else {
    if (open) { open.end = clamp(r.end, open.start + 1000); changed = true; }
    if (b.status !== 'off') { b.status = 'off'; changed = true; }
  }
  if (changed) await persist();
  return changed;
}

export const statusOf = (userId) => bucket(userId).status;

// Wird z.B. beim Start eines Ticket-Timers aufgerufen: ist man nicht eingestempelt, jetzt einstempeln
export async function ensureClockedIn(userId) {
  const b = bucket(userId);
  if (b.status === 'work') return false;
  await clock(userId, 'in');
  return true;
}

// ---------- Korrekturen ----------
function checkRange(start, end) {
  start = Number(start); end = end == null || end === '' ? null : Number(end);
  if (!Number.isFinite(start)) throw err('Ungültige Startzeit');
  if (end != null && (!Number.isFinite(end) || end <= start)) throw err('Ende muss nach dem Beginn liegen');
  if (end != null && end - start > 16 * 3600e3) throw err('Ein Eintrag darf max. 16 Stunden lang sein');
  return { start, end };
}
function checkOverlap(b, start, end, ignoreId) {
  const e2 = end ?? Date.now();
  const hit = b.entries.find((e) => e.id !== ignoreId && start < (e.end ?? Date.now()) && e.start < e2);
  if (hit) throw err('Überschneidet sich mit einem bestehenden Eintrag');
}

export async function addEntry(userId, body) {
  const b = bucket(userId);
  const { start, end } = checkRange(body.start, body.end);
  if (end == null) throw err('Bitte ein Ende angeben');
  checkOverlap(b, start, end);
  b.entries.push({ id: crypto.randomUUID(), start, end, manual: true });
  await persist();
}

export async function updateEntry(userId, id, body) {
  const b = bucket(userId);
  const e = b.entries.find((x) => x.id === id);
  if (!e) throw err('Eintrag nicht gefunden', 404);
  const { start, end } = checkRange(body.start, e.end == null && body.end == null ? null : body.end);
  checkOverlap(b, start, end, id);
  Object.assign(e, { start, end, manual: true });
  if (e.end != null && b.status === 'work' && !b.entries.some((x) => x.end == null)) b.status = 'off';
  await persist();
}

export async function deleteEntry(userId, id) {
  const b = bucket(userId);
  const i = b.entries.findIndex((x) => x.id === id);
  if (i < 0) throw err('Eintrag nicht gefunden', 404);
  const [e] = b.entries.splice(i, 1);
  if (e.end == null) b.status = 'off';
  await persist();
}

// ---------- Abwesenheiten ----------
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

export async function addAbsence(userId, body) {
  const b = bucket(userId);
  const { type, from, note } = body || {};
  const to = body?.to || from;
  if (!ABSENCE_TYPES[type]) throw err('Unbekannte Abwesenheitsart');
  if (!isDay(from) || !isDay(to) || to < from) throw err('Ungültiger Zeitraum');
  const half = Boolean(body.half) && from === to;
  if (b.absences.some((a) => from <= a.to && a.from <= to)) throw err('Für diesen Zeitraum gibt es schon eine Abwesenheit');
  const a = { id: crypto.randomUUID(), type, from, to, half, note: String(note || '').slice(0, 300), createdAt: Date.now() };
  b.absences.push(a);
  await persist();
  return a;
}

export async function deleteAbsence(userId, id) {
  const b = bucket(userId);
  const i = b.absences.findIndex((a) => a.id === id);
  if (i < 0) throw err('Abwesenheit nicht gefunden', 404);
  b.absences.splice(i, 1);
  await persist();
}

// ---------- Einstellungen ----------
export async function saveSettings(userId, body) {
  const b = bucket(userId);
  const s = { ...b.settings };
  const num = (v, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw err('Ungültiger Wert'); return n; };
  if (body.weeklyHours != null) s.weeklyHours = num(body.weeklyHours, 0, 60);
  if (Array.isArray(body.workdays)) {
    s.workdays = [...new Set(body.workdays.map(Number).filter((n) => n >= 0 && n <= 6))].sort();
    if (!s.workdays.length) throw err('Mindestens ein Arbeitstag');
  }
  if (body.vacationDays != null) s.vacationDays = num(body.vacationDays, 0, 60);
  if (body.vacationCarry != null) s.vacationCarry = num(body.vacationCarry, -60, 100);
  if (body.startBalanceMin != null) s.startBalanceMin = Math.round(num(body.startBalanceMin, -100000, 100000));
  if (body.startDate != null) { if (!isDay(body.startDate)) throw err('Ungültiges Startdatum'); s.startDate = body.startDate; }
  b.settings = s;
  await persist();
}
