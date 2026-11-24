// Meldungen pausieren: ganzer Kunde oder einzelnes Gerät (Atera).
// Pausiert heißt: Probleme bleiben sichtbar (grau), zählen aber nicht als kritisch/Warnung,
// erscheinen nicht unter "Braucht Aufmerksamkeit" und färben die Kundenkachel nicht ein.
// Dauer: bis zu einem Zeitpunkt, "bis behoben" (endet automatisch, sobald alles wieder in
// Ordnung ist, damit neue Probleme nicht untergehen) oder unbefristet.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = () => path.join(config.dataDir, 'atera-pauses.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
const write = (v) => { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(`${file()}.tmp`, JSON.stringify(v, null, 1)); fs.renameSync(`${file()}.tmp`, file()); };
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const D = 864e5;
export const DURATIONS = { '4h': 4 * 3600e3, '1d': D, '3d': 3 * D, '7d': 7 * D, '30d': 30 * D, ok: null, forever: null };
export const pauseKey = (type, id) => `${type}:${id}`;

/** aktive Pausen (abgelaufene werden beim Lesen entfernt) */
export function active(now = Date.now()) {
  const all = read();
  const live = Object.fromEntries(Object.entries(all).filter(([, p]) => !p.until || p.until > now));
  if (Object.keys(live).length !== Object.keys(all).length) write(live);
  return live;
}

export function setPause({ type, id, customerId, name, customerName, duration, reason }, user, now = Date.now()) {
  if (!['customer', 'device'].includes(type)) throw bad('Ungültiger Typ');
  if (!id || String(id).length > 80) throw bad('Kunde/Gerät fehlt');
  if (!(duration in DURATIONS)) throw bad('Ungültige Dauer');
  const all = active(now);
  const key = pauseKey(type, id);
  all[key] = {
    key, type, id: String(id), customerId: String(customerId ?? id), name: String(name || '').slice(0, 120), customerName: String(customerName || name || '').slice(0, 120),
    until: DURATIONS[duration] ? now + DURATIONS[duration] : null, untilOk: duration === 'ok',
    reason: String(reason || '').trim().slice(0, 300), by: user || '', at: now,
  };
  write(all);
  return all[key];
}

export function removePause(key) {
  const all = read();
  const had = key in all;
  delete all[key];
  write(all);
  return had;
}

const SEV = { ok: 0, warning: 1, critical: 2 };
const worst = (a, b) => (SEV[b] > SEV[a] ? b : a);

function pauseDevice(d, p) {
  return { ...d, paused: p, pausedStatus: d.status, pausedProblems: d.problems, status: 'ok', problems: [] };
}

/**
 * Wendet Pausen auf die fertige Atera-Übersicht an (rein, testbar).
 * Liefert { customers, resolved } – resolved = Schlüssel der "bis behoben"-Pausen, die enden können.
 */
export function applyPauses(customers, pauses, now = Date.now()) {
  const resolved = [];
  const out = (customers || []).map((c) => {
    // "bis behoben": endet, sobald Kunde bzw. Gerät wieder in Ordnung ist
    let customerPaused = pauses[pauseKey('customer', c.id)] || null;
    if (customerPaused?.untilOk && c.status === 'ok') { resolved.push(customerPaused.key); customerPaused = null; }
    let anyPaused = false;
    const devices = c.devices.map((d) => {
      let dp = pauses[pauseKey('device', d.guid)] || null;
      if (dp?.untilOk && d.status === 'ok' && !d.stale) { resolved.push(dp.key); dp = null; }
      const p = dp || customerPaused;
      if (!p) return d;
      anyPaused = true;
      return pauseDevice(d, p);
    });
    if (!anyPaused && !customerPaused) return c;
    const live = devices.filter((d) => !d.stale);
    const counts = { critical: 0, warning: 0, ok: 0 };
    for (const d of live) counts[d.status]++;
    const problems = customerPaused ? [] : c.problems;
    let status = devices.reduce((s, d) => worst(s, d.status), 'ok');
    status = problems.reduce((s, p) => worst(s, p.status), status);
    const topDev = devices.find((d) => d.problems.length);
    const top = problems[0] || topDev?.problems[0] || null;
    return {
      ...c,
      status, counts, devices,
      problems, pausedProblems: customerPaused ? c.problems : [],
      outage: customerPaused ? false : c.outage,
      headline: top ? (problems[0] ? top.text : `${topDev.name}: ${top.text}`) : null,
      backupIssues: devices.flatMap((d) => d.problems).filter((p) => p.kind === 'backup').length,
      paused: customerPaused,
      pausedStatus: c.status,
      pausedDevices: devices.filter((d) => d.paused && d.pausedStatus !== 'ok').length,
    };
  });
  return { customers: out, resolved: [...new Set(resolved)] };
}
