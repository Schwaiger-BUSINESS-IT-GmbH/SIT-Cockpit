// Atera-Anbindung: liest Kunden, Server (Agents), Firewalls (Netzwerkgeräte)
// und offene Alerts mit dem zentralen API-Schlüssel, bewertet den Zustand und
// hält das Ergebnis im Speicher (Hintergrund-Refresh). Der Browser bekommt nur
// das fertige Ergebnis, nie den Schlüssel.
//
// Bewusst NUR Server und Firewalls: Arbeitsplätze, Drucker, Switches usw.
// und deren Alerts werden nicht angezeigt.
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

// Firewall-Erkennung bei Netzwerkgeräten: SNMP-Typ "Firewall" oder typischer Name
const FW_NAME = /firewall|fortigate|forti|sophos|sonicwall|pfsense|opnsense|watchguard|\bfw\b/i;
export function isFirewall(dev) {
  return dev.Type === 'Firewall' || FW_NAME.test(`${dev.Name || ''} ${dev.Hostname || ''}`);
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

function alertProblems(alerts) {
  const out = [];
  for (const a of alerts) {
    const sev = /crit/i.test(a.Severity) ? 'critical' : /warn/i.test(a.Severity) ? 'warning' : null;
    if (!sev) continue;
    out.push({ status: sev, kind: isBackupAlert(a) ? 'backup' : 'alert', text: a.Title || a.AlertMessage || 'Alert', since: ts(a.Created), alertId: a.AlertID });
  }
  return out;
}
const finish = (problems) => {
  problems.sort((a, b) => SEV[b.status] - SEV[a.status]);
  return problems.reduce((s, p) => worst(s, p.status), 'ok');
};

/** Bewertet einen Server (Agent); liefert { status, problems[], kind, lastSeen } */
export function rateDevice(agent, alerts, now = Date.now()) {
  const kind = deviceKind(agent);
  const problems = [];
  // LastSeen ist in der Atera-Doku nicht garantiert -> Ersatzfelder
  const lastSeen = ts(agent.LastSeen) ?? ts(agent.LastSeenDate) ?? null;
  let stale = false;
  if (agent.Online === false) {
    const off = lastSeen ? now - lastSeen : Infinity;
    if (lastSeen && off >= config.staleServerDays * 864e5) {
      // Lange offline: vermutlich abgebaut -> kein Alarm, nur Aufräum-Hinweis
      stale = true;
      return { status: 'ok', problems: [], kind, lastSeen, stale, staleText: `Seit ${fmtSince(off)} offline – vermutlich abgebaut, in Atera aufräumen` };
    }
    if (off >= config.serverOfflineMinutes * 60000) {
      problems.push({ status: 'critical', kind: 'offline', text: `Server offline seit ${lastSeen ? fmtSince(off) : 'unbekannt'}` });
    }
  }
  problems.push(...alertProblems(alerts));
  for (const d of agent.HardwareDisks || []) {
    const total = Number(d.Total), free = Number(d.Free);
    if (total > 0 && Number.isFinite(free)) {
      const pct = (free / total) * 100;
      const already = problems.some((p) => /disk|laufwerk|speicher|festplatte/i.test(p.text));
      if (pct < 10 && !already) {
        problems.push({ status: pct < 5 ? 'critical' : 'warning', kind: 'disk', text: `Laufwerk ${d.Drive || ''} nur noch ${pct.toFixed(0)} % frei`.replace('  ', ' ') });
      }
    }
  }
  return { status: finish(problems), problems, kind, lastSeen, stale };
}

/** Bewertet eine Firewall (SNMP-, Ping-, TCP- oder HTTP-Gerät) */
export function rateFirewall(dev, alerts) {
  const problems = [];
  // Nur SNMP-Geräte melden einen Online-Status; Ping/TCP/HTTP nur über Alerts
  if (dev.Online === false) problems.push({ status: 'critical', kind: 'offline', text: 'Firewall nicht erreichbar' });
  problems.push(...alertProblems(alerts));
  return { status: finish(problems), problems };
}

function diskSummary(agent) {
  return (agent.HardwareDisks || [])
    .filter((d) => Number(d.Total) > 0)
    .map((d) => ({ drive: d.Drive, totalGb: Math.round(d.Total / 1024), freePct: Math.round((d.Free / d.Total) * 100) }));
}

const sortDevices = (list) => list.sort((a, b) =>
  (a.stale ? 1 : 0) - (b.stale ? 1 : 0) || SEV[b.status] - SEV[a.status] || (a.kind === 'firewall' ? -1 : 0) - (b.kind === 'firewall' ? -1 : 0) || a.name.localeCompare(b.name, 'de'));

/**
 * Kunden mit Servern und Firewalls, Zustand und Problemen aufbereiten.
 * net = { snmp: [], generic: [], tcp: [], http: [] } (Atera-Netzwerkgeräte)
 */
export function buildOverview({ customers, agents, alerts, net = {} }, now = Date.now()) {
  const alertsByDevice = new Map();
  for (const a of alerts) {
    if (a.Archived || !a.DeviceGuid) continue;
    if (!alertsByDevice.has(a.DeviceGuid)) alertsByDevice.set(a.DeviceGuid, []);
    alertsByDevice.get(a.DeviceGuid).push(a);
  }
  const byCustomer = new Map(customers.map((c) => [c.CustomerID, { id: c.CustomerID, name: c.CustomerName, city: c.City || '', devices: [] }]));
  const bucket = (id, name) => {
    let c = byCustomer.get(id);
    if (!c) { c = { id, name: name || `Kunde ${id}`, city: '', devices: [] }; byCustomer.set(id, c); }
    return c;
  };

  // Server
  for (const ag of agents) {
    if (deviceKind(ag) !== 'server') continue;
    const r = rateDevice(ag, alertsByDevice.get(ag.DeviceGuid) || [], now);
    bucket(ag.CustomerID, ag.CustomerName).devices.push({
      id: ag.AgentID,
      guid: ag.DeviceGuid,
      name: ag.MachineName || ag.AgentName || ag.SystemName,
      description: ag.ComputerDescription || '',
      kind: 'server',
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
      stale: r.stale,
      staleText: r.staleText || null,
    });
  }

  // Firewalls
  const nets = [['snmp', 'SNMP'], ['generic', 'Ping'], ['tcp', 'TCP-Port'], ['http', 'HTTP']];
  for (const [key, label] of nets) {
    for (const d of net[key] || []) {
      if (!isFirewall(d)) continue;
      const r = rateFirewall(d, alertsByDevice.get(d.DeviceGuid) || []);
      bucket(d.CustomerID, d.CustomerName).devices.push({
        id: d.DeviceID,
        guid: d.DeviceGuid,
        name: d.Name || d.Hostname || `Firewall ${d.DeviceID}`,
        description: [d.Model && d.Model !== 'Agent' ? d.Model : '', d.Hostname || d.URL || ''].filter(Boolean).join(' · '),
        kind: 'firewall',
        monitoring: label,
        os: '',
        online: d.Online === undefined ? null : d.Online !== false, // null = kein Status (nur Alerts)
        lastSeen: null,
        disks: [],
        url: `${config.ateraWebUrl}/new/devices`,
        status: r.status,
        problems: r.problems,
      });
    }
  }

  const list = [];
  for (const c of byCustomer.values()) {
    if (!c.devices.length) continue; // Kunden ohne Server/Firewall nicht anzeigen
    const devices = sortDevices(c.devices);
    const allServers = devices.filter((d) => d.kind === 'server');
    const servers = allServers.filter((d) => !d.stale);
    const firewalls = devices.filter((d) => d.kind === 'firewall');
    // Möglicher Ausfall: Firewall nicht erreichbar UND Server vor Kurzem offline gegangen
    // nicht erreichbar: SNMP meldet offline, oder (Ping/TCP/HTTP ohne Status) kritischer Alert
    const fwDown = firewalls.filter((d) => d.online === false || (d.online === null && d.status === 'critical'));
    const srvRecentlyOff = servers.filter((d) => !d.online && d.lastSeen && now - d.lastSeen < 864e5);
    const outage = fwDown.length > 0 && srvRecentlyOff.length > 0 && srvRecentlyOff.length >= servers.filter((d) => d.online || srvRecentlyOff.includes(d)).length * 0.5;
    const problems = outage
      ? [{ status: 'critical', kind: 'outage', text: `Möglicher Strom- oder Internetausfall: Firewall und ${srvRecentlyOff.length === 1 ? '1 Server' : `${srvRecentlyOff.length} Server`} gleichzeitig nicht erreichbar` }]
      : [];

    const counts = { critical: 0, warning: 0, ok: 0 };
    for (const d of devices) if (!d.stale) counts[d.status]++;
    let status = devices.reduce((s, d) => worst(s, d.status), 'ok');
    status = problems.reduce((s, p) => worst(s, p.status), status);
    const top = problems[0] || devices.find((d) => d.problems.length)?.problems[0] || null;
    const topDevice = problems[0] ? null : devices.find((d) => d.problems.length)?.name || null;

    list.push({
      id: c.id,
      name: c.name,
      city: c.city,
      status,
      counts,
      deviceCount: devices.length,
      online: devices.filter((d) => d.online === true).length,
      servers: servers.length,
      serversDown: servers.filter((d) => !d.online).length,
      staleServers: allServers.length - servers.length,
      firewalls: firewalls.length,
      firewallsDown: fwDown.length,
      backupIssues: devices.flatMap((d) => d.problems).filter((p) => p.kind === 'backup').length,
      outage,
      headline: top ? (topDevice ? `${topDevice}: ${top.text}` : top.text) : null,
      problems,
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
  const soft = (p, extra) => all(p, extra).catch((e) => { console.error(`Atera ${p}:`, e.message); return []; });
  const [customers, agents, alerts, snmp, generic, tcp, http] = await Promise.all([
    all('/customers'),
    all('/agents'),
    soft('/alerts', { alertStatus: 'Open' }),
    soft('/devices/snmpdevices'),
    soft('/devices/genericdevices'),
    soft('/devices/tcpdevices'),
    soft('/devices/httpdevices'),
  ]);
  return buildOverview({ customers, agents, alerts, net: { snmp, generic, tcp, http } });
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
