// Atera-Anbindung: liest Kunden, Geräte (Agents) und offene Alerts mit dem
// zentralen API-Schlüssel, bewertet den Zustand nach den Regeln aus
// docs/anforderungen.md und hält das Ergebnis im Speicher (Hintergrund-Refresh).
// Der Browser bekommt nur das fertige Ergebnis, nie den Schlüssel.
import { config } from './config.js';

export class AteraError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Neue Atera-Schlüssel (JWT, seit der Umstellung 12/2026) gehen als Bearer-Token,
// alte Schlüssel weiterhin als X-API-KEY.
export function ateraAuthHeaders(key) {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key) ? { Authorization: `Bearer ${key}` } : { 'X-API-KEY': key };
}

async function request(path, query = {}) {
  const url = new URL(config.ateraBaseUrl.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { ...ateraAuthHeaders(config.ateraApiKey), Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AteraError(res.status, res.status === 401 || res.status === 403
      ? 'Atera lehnt den API-Schlüssel ab'
      : `Atera antwortet mit HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Alle Seiten eines Listen-Endpunkts laden (Atera: items/page/totalPages, max. 50 je Seite)
async function all(path, extra = {}) {
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const d = await request(path, { page, itemsInPage: 50, ...extra });
    out.push(...(d.items || []));
    if (!d.totalPages || page >= d.totalPages) break;
  }
  return out;
}

// Atera liefert Zeitstempel teils ohne Zeitzone – die sind UTC
function ts(v) {
  if (!v) return null;
  const s = String(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
  return Number.isFinite(t) ? t : null;
}

const SEV = { ok: 0, warning: 1, critical: 2 };
const worst = (a, b) => (SEV[b] > SEV[a] ? b : a);

export function deviceKind(agent) {
  const t = `${agent.OSType || ''} ${agent.OS || ''}`;
  if (/domain controller|server/i.test(t)) return 'server';
  if (/mac|windows|linux|work ?station/i.test(t)) return 'workstation';
  return 'other';
}

const isBackupAlert = (a) => /backup|sicherung|veeam|acronis|datto|synology hyper/i.test(
  `${a.AlertCategoryID || ''} ${a.Title || ''} ${a.Source || ''}`);

function fmtSince(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 Tag' : `${d} Tagen`;
}

/** Bewertet ein Gerät; liefert { status, problems[] } */
export function rateDevice(agent, alerts, now = Date.now()) {
  const kind = deviceKind(agent);
  const problems = [];
  // LastSeen ist in der Atera-Doku nicht garantiert -> Ersatzfelder
  const lastSeen = ts(agent.LastSeen) ?? ts(agent.LastSeenDate) ?? null;
  if (agent.Online === false) {
    const off = lastSeen ? now - lastSeen : Infinity;
    if (kind === 'server' && off >= config.serverOfflineMinutes * 60000) {
      problems.push({ status: 'critical', kind: 'offline', text: `Server offline seit ${lastSeen ? fmtSince(off) : 'unbekannt'}` });
    } else if (kind !== 'server' && off >= config.workstationOfflineDays * 864e5) {
      problems.push({ status: 'warning', kind: 'offline', text: lastSeen ? `Seit ${fmtSince(off)} nicht online` : 'Offline (zuletzt gesehen unbekannt)' });
    }
  }
  for (const a of alerts) {
    const sev = /crit/i.test(a.Severity) ? 'critical' : /warn/i.test(a.Severity) ? 'warning' : null;
    if (!sev) continue;
    problems.push({
      status: sev,
      kind: isBackupAlert(a) ? 'backup' : 'alert',
      text: a.Title || a.AlertMessage || 'Alert',
      since: ts(a.Created),
      alertId: a.AlertID,
    });
  }
  for (const d of agent.HardwareDisks || []) {
    const total = Number(d.Total), free = Number(d.Free);
    if (total > 0 && Number.isFinite(free)) {
      const pct = (free / total) * 100;
      const already = problems.some((p) => /disk|laufwerk|speicher/i.test(p.text));
      if (pct < 10 && !already) {
        problems.push({ status: pct < 5 ? 'critical' : 'warning', kind: 'disk', text: `Laufwerk ${d.Drive || ''} nur noch ${pct.toFixed(0)} % frei`.replace('  ', ' ') });
      }
    }
  }
  const status = problems.reduce((s, p) => worst(s, p.status), 'ok');
  problems.sort((a, b) => SEV[b.status] - SEV[a.status]);
  return { status, problems, kind, lastSeen };
}

function diskSummary(agent) {
  return (agent.HardwareDisks || [])
    .filter((d) => Number(d.Total) > 0)
    .map((d) => ({ drive: d.Drive, totalGb: Math.round(d.Total / 1024), freePct: Math.round((d.Free / d.Total) * 100) }));
}

/** Kunden mit Geräten, Zustand und Problemen aufbereiten */
export function buildOverview({ customers, agents, alerts }, now = Date.now()) {
  const openAlerts = alerts.filter((a) => !a.Archived);
  const alertsByDevice = new Map();
  const alertsByCustomer = new Map();
  for (const a of openAlerts) {
    if (a.DeviceGuid) {
      if (!alertsByDevice.has(a.DeviceGuid)) alertsByDevice.set(a.DeviceGuid, []);
      alertsByDevice.get(a.DeviceGuid).push(a);
    }
    if (!alertsByCustomer.has(a.CustomerID)) alertsByCustomer.set(a.CustomerID, []);
    alertsByCustomer.get(a.CustomerID).push(a);
  }

  const byCustomer = new Map(customers.map((c) => [c.CustomerID, {
    id: c.CustomerID,
    name: c.CustomerName,
    city: c.City || '',
    devices: [],
  }]));

  for (const ag of agents) {
    let c = byCustomer.get(ag.CustomerID);
    if (!c) {
      c = { id: ag.CustomerID, name: ag.CustomerName || `Kunde ${ag.CustomerID}`, city: '', devices: [] };
      byCustomer.set(ag.CustomerID, c);
    }
    const r = rateDevice(ag, alertsByDevice.get(ag.DeviceGuid) || [], now);
    c.devices.push({
      id: ag.AgentID,
      guid: ag.DeviceGuid,
      name: ag.MachineName || ag.AgentName || ag.SystemName,
      description: ag.ComputerDescription || '',
      kind: r.kind,
      os: ag.OS || ag.OSType || '',
      online: ag.Online !== false,
      lastSeen: r.lastSeen,
      lastReboot: ts(ag.LastRebootTime),
      user: ag.CurrentLoggedUsers || '',
      ip: ag.ReportedFromIP || (Array.isArray(ag.IpAddresses) ? ag.IpAddresses[0] : ag.IpAddresses) || '',
      cpu: ag.Processor || '',
      memoryMb: ag.Memory || null,
      disks: diskSummary(ag),
      url: ag.AppViewUrl || `${config.ateraWebUrl}/new/agent/${ag.AgentID}`,
      status: r.status,
      problems: r.problems,
    });
  }

  const list = [];
  for (const c of byCustomer.values()) {
    const devices = c.devices.sort((a, b) =>
      SEV[b.status] - SEV[a.status] || (a.kind === 'server' ? -1 : 0) - (b.kind === 'server' ? -1 : 0) || a.name.localeCompare(b.name, 'de'));
    const online = devices.filter((d) => d.online).length;
    // Möglicher Ausfall: viele Geräte, die vor Kurzem noch da waren, gleichzeitig offline
    const recent = devices.filter((d) => d.online || (d.lastSeen && now - d.lastSeen < 864e5 * 7));
    const recentlyOff = recent.filter((d) => !d.online && d.lastSeen && now - d.lastSeen < 864e5);
    const outage = recentlyOff.length >= 3 && recentlyOff.length / Math.max(recent.length, 1) >= 0.5;

    // Alerts ohne Gerätebezug (z. B. Kunden-Backup) beim Kunden führen
    const deviceGuids = new Set(devices.map((d) => d.guid));
    const loose = (alertsByCustomer.get(c.id) || []).filter((a) => !a.DeviceGuid || !deviceGuids.has(a.DeviceGuid));
    const customerProblems = rateDevice({ Online: true }, loose, now).problems;
    if (outage) {
      // Betroffene Geräte sichtbar machen, auch wenn sie für sich noch unauffällig wären
      for (const d of recentlyOff) {
        if (!d.problems.length) {
          d.problems.push({ status: 'warning', kind: 'offline', text: `Offline seit ${fmtSince(now - d.lastSeen)} (möglicher Ausfall)` });
          d.status = 'warning';
        }
      }
      devices.sort((a, b) => SEV[b.status] - SEV[a.status] || (a.kind === 'server' ? -1 : 0) - (b.kind === 'server' ? -1 : 0) || a.name.localeCompare(b.name, 'de'));
      customerProblems.unshift({ status: 'critical', kind: 'outage', text: `Möglicher Strom- oder Internetausfall: ${recentlyOff.length} von ${recent.length} Geräten gleichzeitig offline` });
    }

    const counts = { critical: 0, warning: 0, ok: 0 };
    for (const d of devices) counts[d.status]++;
    let status = devices.reduce((s, d) => worst(s, d.status), 'ok');
    status = customerProblems.reduce((s, p) => worst(s, p.status), status);
    const backupIssues = [...devices.flatMap((d) => d.problems), ...customerProblems].filter((p) => p.kind === 'backup').length;
    // Wichtigstes Problem für die Kachel
    const top = customerProblems[0] || devices.find((d) => d.problems.length)?.problems[0] || null;
    const topDevice = customerProblems[0] ? null : devices.find((d) => d.problems.length)?.name || null;

    list.push({
      id: c.id,
      name: c.name,
      city: c.city,
      status,
      counts,
      deviceCount: devices.length,
      online,
      servers: devices.filter((d) => d.kind === 'server').length,
      serversDown: devices.filter((d) => d.kind === 'server' && !d.online).length,
      backupIssues,
      outage,
      headline: top ? (topDevice ? `${topDevice}: ${top.text}` : top.text) : null,
      problems: customerProblems,
      devices,
      url: `${config.ateraWebUrl}/new/customer/${c.id}`,
    });
  }
  list.sort((a, b) => SEV[b.status] - SEV[a.status]
    || (b.counts.critical - a.counts.critical)
    || (b.counts.warning - a.counts.warning)
    || a.name.localeCompare(b.name, 'de'));
  return list;
}

// ---------- Zwischenspeicher mit Hintergrund-Aktualisierung ----------
let cache = { at: 0, customers: null, error: null, loading: null };

async function load() {
  const [customers, agents, alerts] = await Promise.all([
    all('/customers'),
    all('/agents'),
    all('/alerts', { alertStatus: 'Open' }).catch((e) => { console.error('Atera-Alerts:', e.message); return []; }),
  ]);
  return buildOverview({ customers, agents, alerts });
}

export async function refresh() {
  if (!config.ateraApiKey) {
    cache = { ...cache, at: Date.now(), customers: [], error: 'ATERA_API_KEY ist nicht gesetzt' };
    return cache;
  }
  if (cache.loading) return cache.loading;
  cache.loading = load()
    .then((customers) => { cache = { at: Date.now(), customers, error: null, loading: null }; return cache; })
    .catch((e) => {
      console.error('Atera-Aktualisierung fehlgeschlagen:', e.message);
      cache = { ...cache, error: e.message, loading: null, failedAt: Date.now() };
      return cache;
    });
  return cache.loading;
}

export async function overview({ force = false } = {}) {
  const stale = Date.now() - cache.at > config.ateraRefreshSeconds * 1000;
  if (!cache.customers || force) await refresh();
  else if (stale) refresh(); // im Hintergrund, alter Stand wird sofort geliefert
  return cache;
}

export function startBackgroundRefresh() {
  refresh();
  setInterval(refresh, Math.max(60, config.ateraRefreshSeconds) * 1000).unref();
}

/** weclapp-Kundennummer aus dem Atera-Kundenfeld (optional, 1 Std. gepuffert) */
const numberCache = new Map();
export async function customerNumber(customerId) {
  const hit = numberCache.get(customerId);
  if (hit && Date.now() - hit.at < 3600e3) return hit.value;
  let value = null;
  try {
    const d = await request(`/customvalues/customerfield/${encodeURIComponent(customerId)}/${encodeURIComponent(config.ateraCustomerNumberField)}`);
    const row = Array.isArray(d) ? d[0] : d;
    value = row?.ValueAsString || row?.Value || null;
  } catch { /* Feld nicht vorhanden -> Zuordnung über den Namen */ }
  numberCache.set(customerId, { at: Date.now(), value });
  return value;
}
