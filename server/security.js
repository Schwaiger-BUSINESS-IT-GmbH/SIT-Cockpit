// Security-Übersicht: Sicherheitsmeldungen der Hersteller, deren Produkte wir bei Kunden einsetzen.
//
// Quellen (öffentlich, ohne Schlüssel):
//   CISA KEV   – Lücken, die nachweislich aktiv ausgenutzt werden (wichtigstes Signal)
//   Fortinet   – PSIRT-RSS + CSAF je Meldung (betroffene Versionen, Fix-Version)
//   Microsoft  – Security Update Guide (kritisch, aktiv ausgenutzt oder öffentlich bekannt)
//   Synology   – Security Advisories (Webseite)
//   NVD        – Stichwortsuche für weitere Produkte (Veeam, 3CX, ESXi …)
//   EPSS       – Wahrscheinlichkeit einer Ausnutzung in den nächsten 30 Tagen (FIRST.org)
//
// Abgleich mit den Kunden über die Atera-Geräteliste (Firewall-Namen, Betriebssysteme, NAS).
// Die Firmware-Version kennt Atera nicht -> "betroffen" heißt: Kunde setzt das Produkt ein, Version prüfen.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as atera from './atera.js';

const D = 864e5;
const UA = 'SIT-Cockpit Security-Uebersicht';
const cfgFile = new URL('../config/security.json', import.meta.url);
const statusFile = () => path.join(config.dataDir, 'security-status.json');
const fortinetFile = () => path.join(config.dataDir, 'security-fortinet.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1)); fs.renameSync(`${f}.tmp`, f); };
const rx = (s) => (s ? new RegExp(s, 'i') : null);
const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const uniq = (a) => [...new Set(a.filter(Boolean))];
const CVE_RE = /CVE-\d{4}-\d{4,}/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref());

export function loadSettings() {
  const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  return {
    msrcExclude: rx(raw.msrcExclude),
    products: raw.products.map((p) => ({
      ...p,
      fortinetRe: rx(p.fortinet), msrcRe: p.msrc && p.msrc !== '*' ? rx(p.msrc) : null, msrcDefault: p.msrc === '*',
      synologyRe: rx(p.synology), kevVendor: p.kev?.vendor?.toLowerCase(), kevRe: rx(p.kev?.product),
      invMatch: rx(p.inventory?.match), invOs: rx(p.inventory?.os), invKind: p.inventory?.kind || null,
    })),
  };
}

export function severityOf(cvss) {
  if (cvss == null) return null;
  return cvss >= 9 ? 'critical' : cvss >= 7 ? 'high' : cvss >= 4 ? 'medium' : 'low';
}
const SEV_WORD = { critical: 'critical', important: 'high', high: 'high', moderate: 'medium', medium: 'medium', low: 'low' };

async function fetchText(url, { accept, timeout = 45000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept || '*/*', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, { accept: 'application/json', ...opts }));

// ---------------------------------------------------------------- Quellen
/** CISA KEV: { cve -> eintrag } */
export async function loadKev() {
  const d = await fetchJson(config.security.kevUrl);
  return (d.vulnerabilities || []).map((v) => ({
    cve: v.cveID, vendor: v.vendorProject || '', product: v.product || '', name: v.vulnerabilityName || '',
    summary: v.shortDescription || '', added: Date.parse(v.dateAdded) || null, due: Date.parse(v.dueDate) || null,
    ransomware: /known/i.test(v.knownRansomwareCampaignUse || '') && !/unknown/i.test(v.knownRansomwareCampaignUse || ''),
    action: v.requiredAction || '',
  }));
}

const tag = (s, name) => (s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() || '';
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export function parseFortinetRss(xml) {
  return xml.split('<item>').slice(1).map((it) => {
    const desc = tag(it, 'description');
    const text = stripHtml(desc);
    const link = tag(it, 'link');
    return {
      id: (link.match(/FG-IR-[\d-]+/i) || [link])[0].toUpperCase(),
      title: stripHtml(tag(it, 'title')), url: link, published: Date.parse(tag(it, 'pubDate')) || null,
      cvss: n((text.match(/CVSSv3 Score:\s*([\d.]+)/i) || [])[1]),
      summary: text.replace(/CVSSv3 Score:\s*[\d.]+/i, '').replace(/Revised on .*$/i, '').trim().slice(0, 600),
      cves: uniq(`${tag(it, 'title')} ${text}`.match(CVE_RE) || []),
      csaf: tag(it, 'csaf:link'),
    };
  });
}

export function parseCsaf(d) {
  const names = [];
  const walk = (b) => { if (!b) return; if (b.product?.name) names.push(b.product.name); (b.branches || []).forEach(walk); };
  (d.product_tree?.branches || []).forEach(walk);
  const vulns = d.vulnerabilities || [];
  const scores = vulns.flatMap((v) => (v.scores || []).map((s) => n(s.cvss_v3?.baseScore))).filter((x) => x != null);
  const affected = uniq(vulns.flatMap((v) => v.product_status?.known_affected || []));
  const fix = uniq(vulns.flatMap((v) => (v.remediations || []).filter((r) => r.category === 'vendor_fix').flatMap((r) => String(r.details || '').split('\n'))).map((s) => s.trim()));
  return {
    title: d.document?.title || '',
    updated: Date.parse(d.document?.tracking?.current_release_date) || null,
    published: Date.parse(d.document?.tracking?.initial_release_date) || null,
    cves: uniq(vulns.map((v) => v.cve)),
    cvss: scores.length ? Math.max(...scores) : null,
    products: uniq(names.map((x) => x.replace(/\s+[\d.<>=|x*-]+.*$/, '').trim())),
    affected: affected.slice(0, 12),
    fix: fix.slice(0, 12),
  };
}

/** Fortinet: RSS (nur die letzten ~50 Meldungen) + CSAF, gesammelt in DATA_DIR, damit die Historie wächst */
async function loadFortinet() {
  const store = readJson(fortinetFile(), {});
  const items = parseFortinetRss(await fetchText(config.security.fortinetUrl));
  const todo = items.filter((i) => !store[i.id] || (i.published && store[i.id].rssPublished !== i.published));
  for (let k = 0; k < todo.length; k += 4) {
    await Promise.all(todo.slice(k, k + 4).map(async (i) => {
      let csaf = null;
      if (i.csaf) { try { csaf = parseCsaf(await fetchJson(i.csaf, { timeout: 20000 })); } catch { /* nur RSS-Daten */ } }
      store[i.id] = {
        id: i.id, url: i.url, title: csaf?.title || i.title, summary: i.summary, rssPublished: i.published,
        published: csaf?.published || i.published, updated: csaf?.updated || i.published,
        cves: uniq([...(csaf?.cves || []), ...i.cves]), cvss: csaf?.cvss ?? i.cvss,
        products: csaf?.products?.length ? csaf.products : [], productText: `${i.title} ${i.summary}`,
        affected: csaf?.affected || [], fix: csaf?.fix || [],
      };
    }));
  }
  // nur 2 Jahre aufbewahren
  for (const [id, a] of Object.entries(store)) if ((a.published || 0) < Date.now() - 730 * D) delete store[id];
  writeJson(fortinetFile(), store);
  return Object.values(store);
}

/** Microsoft Security Update Guide: kritisch, aktiv ausgenutzt oder öffentlich bekannt – nur Microsoft als CNA */
async function loadMsrc(days = 180) {
  const since = new Date(Date.now() - days * D).toISOString().replace(/\.\d+Z$/, 'Z');
  const filter = `releaseDate ge ${since} and issuingCna eq 'Microsoft' and (severity eq 'Critical' or exploited eq 'Yes' or publiclyDisclosed eq 'Yes')`;
  let url = `${config.security.msrcUrl}?$filter=${encodeURIComponent(filter)}&$top=500`;
  const out = [];
  for (let page = 0; url && page < 20; page++) {
    const d = await fetchJson(url);
    out.push(...(d.value || []));
    url = d['@odata.nextLink'] || null;
  }
  return out.map((v) => ({
    cve: v.cveNumber, title: v.cveTitle || v.cveNumber, tag: v.tag || '', severity: SEV_WORD[String(v.severity || '').toLowerCase()] || null,
    impact: v.impact || '', cvss: n(v.baseScore), exploited: v.exploited === 'Yes', disclosed: v.publiclyDisclosed === 'Yes',
    action: v.customerActionRequired !== false, published: Date.parse(v.releaseDate) || null, updated: Date.parse(v.latestRevisionDate) || null,
    release: v.releaseNumber || '',
  }));
}

export function parseSynology(html) {
  const out = [];
  const re = /href="(?:\/[a-z-]+\/)?security\/advisory\/(Synology_SA_[\d_]+)"[^>]*>([^<]+)<\/a>[\s\S]*?impact_txt">([^<]+)<[\s\S]*?status_txt">([^<]+)<[\s\S]*?<time>([^<]+)<\/time>/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = stripHtml(m[2]);
    const sev = m[3].trim().toLowerCase();
    out.push({
      id: title.match(/Synology-SA-\d+:\d+/)?.[0] || m[1], title, url: `https://www.synology.com/en-global/security/advisory/${m[1]}`,
      severity: SEV_WORD[sev] || null, notAffected: /not affected/.test(sev), vendorStatus: m[4].trim(),
      updated: Date.parse(`${m[5].trim().replace(' ', 'T')}+08:00`) || null,
    });
  }
  return out;
}
const loadSynology = async () => parseSynology(await fetchText(config.security.synologyUrl, { accept: 'text/html' }));

/** NVD-Stichwortsuche (max. 120 Tage je Abfrage), ohne Schlüssel 5 Abfragen / 30 s */
async function loadNvd(products) {
  const end = new Date();
  const start = new Date(Date.now() - 119 * D);
  const fmt = (d) => d.toISOString().replace('Z', '');
  const out = [];
  const list = products.filter((p) => p.nvd);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (i && !config.demo) await sleep(config.security.nvdApiKey ? 800 : 6500);
    const url = `${config.security.nvdUrl}?keywordSearch=${encodeURIComponent(p.nvd)}&pubStartDate=${fmt(start)}&pubEndDate=${fmt(end)}&resultsPerPage=200`;
    const d = await fetchJson(url, { headers: config.security.nvdApiKey ? { apiKey: config.security.nvdApiKey } : {} });
    for (const v of d.vulnerabilities || []) {
      const c = v.cve || {};
      const m = c.metrics || {};
      const metric = (m.cvssMetricV40 || m.cvssMetricV31 || m.cvssMetricV30 || [])[0];
      out.push({
        productId: p.id, cve: c.id, published: Date.parse(c.published) || null, updated: Date.parse(c.lastModified) || null,
        cvss: n(metric?.cvssData?.baseScore), summary: (c.descriptions || []).find((x) => x.lang === 'en')?.value || '',
        status: c.vulnStatus || '',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Zwischenspeicher
const state = {
  sources: {}, // name -> { at, error, count, data }
  epss: new Map(), // cve -> { epss, at }
  refreshing: null,
  at: 0,
};
const SOURCES = { kev: 'CISA KEV', fortinet: 'Fortinet PSIRT', msrc: 'Microsoft', synology: 'Synology', nvd: 'NVD' };

async function runSource(name, fn) {
  try {
    const data = await fn();
    state.sources[name] = { at: Date.now(), error: null, count: data.length, data };
  } catch (e) {
    const prev = state.sources[name];
    state.sources[name] = { ...(prev || { data: [] }), error: e.message, failedAt: Date.now() };
    console.error(`Security ${name}:`, e.message);
  }
}

export function refresh() {
  if (state.refreshing) return state.refreshing;
  const settings = loadSettings();
  state.refreshing = Promise.all([
    runSource('kev', loadKev),
    runSource('fortinet', loadFortinet),
    runSource('msrc', () => loadMsrc(180)),
    runSource('synology', loadSynology),
    runSource('nvd', () => loadNvd(settings.products)),
  ]).then(() => { state.at = Date.now(); }).finally(() => { state.refreshing = null; });
  return state.refreshing;
}

async function loadEpss(cves) {
  const need = cves.filter((c) => !state.epss.has(c) || Date.now() - state.epss.get(c).at > 12 * 3600e3);
  for (let i = 0; i < need.length; i += 80) {
    const chunk = need.slice(i, i + 80);
    try {
      const d = await fetchJson(`${config.security.epssUrl}?cve=${chunk.join(',')}`, { timeout: 15000 });
      const got = new Map((d.data || []).map((r) => [r.cve, n(r.epss)]));
      for (const c of chunk) state.epss.set(c, { epss: got.get(c) ?? null, at: Date.now() });
    } catch { break; /* EPSS ist Zusatzinfo */ }
  }
}

// ---------------------------------------------------------------- Bearbeitungsstatus
export const STATUSES = ['new', 'progress', 'done', 'irrelevant'];
export function setStatus(key, { status, note }, user) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error('Ungültiger Status'), { status: 400 });
  const all = readJson(statusFile(), {});
  all[key] = { status, note: String(note || '').slice(0, 500), by: user || '', at: Date.now() };
  writeJson(statusFile(), all);
  return all[key];
}

// ---------------------------------------------------------------- Tickets je Meldung und Kunde
const ticketsFile = () => path.join(config.dataDir, 'security-tickets.json');
export const ticketLinks = (key) => readJson(ticketsFile(), {})[key] || {};
export function recordTicket(key, customerId, ticket, user) {
  const all = readJson(ticketsFile(), {});
  all[key] = { ...(all[key] || {}), [String(customerId)]: { id: String(ticket.id), number: ticket.number, by: user || '', at: Date.now() } };
  writeJson(ticketsFile(), all);
  return all[key][String(customerId)];
}

/** Betroffene Kunden einer Meldung mit ihren Geräten (für die Ticket-Anlage) */
export async function itemForTickets(key) {
  const r = await securityReport({ days: 365 });
  const it = r.items.find((x) => x.key === key);
  if (!it) return null;
  const ov = await atera.overview().catch(() => ({ inventory: [] }));
  const devices = matchInventory(loadSettings().products, ov.inventory || [])[it.productId] || [];
  const byId = new Map(devices.map((c) => [String(c.id), c.devices]));
  return { ...it, customers: it.customers.map((c) => ({ ...c, deviceList: byId.get(String(c.id)) || [] })), ateraCustomers: ov.customers || [] };
}

// ---------------------------------------------------------------- Abgleich
/** Kunden/Geräte je Produkt aus der Atera-Geräteliste */
export function matchInventory(products, inventory) {
  const out = {};
  for (const p of products) {
    if (!p.invMatch && !p.invOs) continue;
    const devs = inventory.filter((d) => (!p.invKind || d.kind === p.invKind)
      && ((p.invOs && p.invOs.test(d.os || '')) || (p.invMatch && p.invMatch.test(d.text || ''))));
    const byCustomer = new Map();
    for (const d of devs) {
      const c = byCustomer.get(d.customerId) || { id: d.customerId, name: d.customer, devices: [] };
      c.devices.push({ name: d.name, kind: d.kind, os: d.os });
      byCustomer.set(d.customerId, c);
    }
    out[p.id] = [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  return out;
}

const productFor = (products, field, text) => products.find((p) => p[field]?.test(text));
const MONTHS = { Jan: 'Jänner', Feb: 'Februar', Mar: 'März', Apr: 'April', May: 'Mai', Jun: 'Juni', Jul: 'Juli', Aug: 'August', Sep: 'September', Oct: 'Oktober', Nov: 'November', Dec: 'Dezember' };
export const releaseLabel = (r) => { const m = String(r).match(/^(\d{4})-([A-Za-z]{3})/); return m ? `${MONTHS[m[2]] || m[2]} ${m[1]}` : r; };

/** Baut die Meldungsliste aus den gepufferten Quellen (rein, testbar) */
export function buildItems({ settings, sources, now = Date.now() }) {
  const P = settings.products;
  const items = [];
  const kev = new Map((sources.kev || []).map((k) => [k.cve, k]));
  const usedKev = new Set();
  const withKev = (it) => {
    const hits = it.cves.map((c) => kev.get(c)).filter(Boolean);
    hits.forEach((h) => usedKev.add(h.cve));
    if (hits.length) {
      const h = hits.sort((a, b) => (b.added || 0) - (a.added || 0))[0];
      it.exploited = true;
      it.kev = { added: h.added, due: h.due, ransomware: hits.some((x) => x.ransomware), action: h.action };
    }
    return it;
  };

  for (const a of sources.fortinet || []) {
    const text = `${(a.products || []).join(' ')} ${a.productText || ''}`;
    const p = productFor(P, 'fortinetRe', text);
    items.push(withKev({
      key: `fortinet:${a.id}`, source: 'fortinet', vendor: 'Fortinet', productId: p?.id || (a.products?.length ? 'fortinet-other' : 'fortinet-info'), id: a.id,
      title: a.title, summary: a.summary || '', cves: a.cves || [], cvss: a.cvss, severity: severityOf(a.cvss),
      published: a.published, updated: a.updated, url: a.url, products: a.products || [], affected: a.affected || [], fix: a.fix || [],
      exploited: false, kev: null,
    }));
  }

  // Microsoft: je Patchday und Produkt eine Meldung (wird ohnehin gesammelt ausgerollt)
  const groups = new Map();
  for (const v of sources.msrc || []) {
    if (!v.action) continue; // Cloud-Dienste: Microsoft behebt selbst
    if (settings.msrcExclude?.test(v.tag)) continue;
    const p = P.find((x) => x.msrcRe?.test(v.tag)) || P.find((x) => x.msrcDefault);
    if (!p) continue;
    const release = v.release || new Date(v.published || now).toISOString().slice(0, 7);
    const k = `${release}:${p.id}`;
    if (!groups.has(k)) groups.set(k, { release, p, rows: [] });
    groups.get(k).rows.push(v);
  }
  for (const { release, p, rows } of groups.values()) {
    rows.sort((a, b) => Number(kev.has(b.cve) || b.exploited) - Number(kev.has(a.cve) || a.exploited) || (b.cvss || 0) - (a.cvss || 0));
    const cvss = rows.map((r) => r.cvss).filter((x) => x != null);
    const exploitedRows = rows.filter((r) => r.exploited || kev.has(r.cve));
    const critical = rows.filter((r) => r.severity === 'critical').length;
    const disclosed = rows.filter((r) => r.disclosed).length;
    items.push(withKev({
      key: `msrc:${release}:${p.id}`, source: 'msrc', vendor: 'Microsoft', productId: p.id, id: release,
      title: `Patchday ${releaseLabel(release)} – ${p.label}`,
      summary: [`${rows.length} Lücke${rows.length === 1 ? '' : 'n'}`, critical ? `${critical} kritisch` : '', exploitedRows.length ? `${exploitedRows.length} aktiv ausgenutzt` : '', disclosed ? `${disclosed} öffentlich bekannt` : ''].filter(Boolean).join(' · '),
      cves: rows.map((r) => r.cve), cvss: cvss.length ? Math.max(...cvss) : null,
      severity: critical ? 'critical' : severityOf(cvss.length ? Math.max(...cvss) : null),
      published: Math.min(...rows.map((r) => r.published || now)), updated: Math.max(...rows.map((r) => r.updated || r.published || 0)),
      url: `https://msrc.microsoft.com/update-guide/releaseNote/${release}`, products: uniq(rows.map((r) => r.tag)), affected: [],
      fix: [`Sicherheitsupdates ${releaseLabel(release)} installieren`],
      details: rows.slice(0, 40).map((r) => ({ cve: r.cve, title: r.title, cvss: r.cvss, severity: r.severity, exploited: r.exploited || kev.has(r.cve), disclosed: r.disclosed, url: `https://msrc.microsoft.com/update-guide/vulnerability/${r.cve}` })),
      exploited: exploitedRows.length > 0, kev: null,
    }));
  }

  for (const s of sources.synology || []) {
    if (s.notAffected) continue;
    const p = productFor(P, 'synologyRe', s.title);
    if (!p) continue;
    items.push({
      key: `synology:${s.id}`, source: 'synology', vendor: 'Synology', productId: p.id, id: s.id,
      title: s.title, summary: `Hersteller-Status: ${s.vendorStatus}`, cves: [], cvss: null, severity: s.severity,
      published: s.updated, updated: s.updated, url: s.url, products: [], affected: [], fix: [], exploited: false, kev: null,
      vendorStatus: s.vendorStatus,
    });
  }

  for (const v of sources.nvd || []) {
    const p = P.find((x) => x.id === v.productId);
    if (!p) continue;
    items.push(withKev({
      key: `nvd:${v.cve}`, source: 'nvd', vendor: p.vendor, productId: p.id, id: v.cve,
      title: v.summary.split(/(?<=\.)\s/)[0].slice(0, 160) || v.cve, summary: v.summary.slice(0, 600), cves: [v.cve], cvss: v.cvss,
      severity: severityOf(v.cvss), published: v.published, updated: v.updated, url: `https://nvd.nist.gov/vuln/detail/${v.cve}`,
      products: [], affected: [], fix: [], exploited: false, kev: null,
    }));
  }

  // Aktiv ausgenutzte Lücken unserer Produkte, zu denen keine Herstellermeldung im Bestand ist
  for (const k of sources.kev || []) {
    if (usedKev.has(k.cve)) continue;
    const p = P.find((x) => x.kevVendor && x.kevVendor === k.vendor.toLowerCase() && x.kevRe?.test(`${k.product} ${k.name}`));
    if (!p) continue;
    items.push({
      key: `kev:${k.cve}`, source: 'kev', vendor: p.vendor, productId: p.id, id: k.cve,
      title: k.name, summary: k.summary, cves: [k.cve], cvss: null, severity: 'critical',
      published: k.added, updated: k.added, url: `https://nvd.nist.gov/vuln/detail/${k.cve}`, products: [k.product], affected: [], fix: k.action ? [k.action] : [],
      exploited: true, kev: { added: k.added, due: k.due, ransomware: k.ransomware, action: k.action },
    });
  }
  return items;
}

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
/** Priorität: aktiv ausgenutzt > Ransomware > CVSS/Schweregrad > EPSS > neu */
export function priority(it, now = Date.now()) {
  let s = 0;
  if (it.exploited) s += 1000;
  if (it.kev?.ransomware) s += 200;
  s += (it.cvss ?? (SEV_RANK[it.severity] || 0) * 2.2) * 40;
  s += (it.epss || 0) * 300;
  s += Math.max(0, 30 - (now - (it.published || 0)) / D) * 2;
  return Math.round(s);
}

export async function securityReport({ days = 90, force = false } = {}) {
  days = [30, 90, 365].includes(Number(days)) ? Number(days) : 90;
  const settings = loadSettings();
  const stale = Date.now() - state.at > config.security.refreshHours * 3600e3;
  if (force || !state.at) {
    // erster Aufruf: höchstens ~20 s warten, langsame Quellen (NVD) kommen beim nächsten Laden dazu
    await Promise.race([refresh(), sleep(force ? 60000 : 20000)]);
  } else if (stale) refresh();

  const now = Date.now();
  const from = now - days * D;
  const sources = Object.fromEntries(Object.entries(state.sources).map(([k, v]) => [k, v.data || []]));
  const ov = await atera.overview().catch(() => ({ inventory: [] }));
  const affected = matchInventory(settings.products, ov.inventory || []);
  const status = readJson(statusFile(), {});
  const tickets = readJson(ticketsFile(), {});

  let items = buildItems({ settings, sources, now }).filter((it) => (it.published || it.updated || 0) >= from || (it.exploited && (it.kev?.added || 0) >= from));
  await loadEpss(uniq(items.flatMap((i) => i.cves)));
  items = items.map((it) => {
    const p = settings.products.find((x) => x.id === it.productId);
    const customers = affected[it.productId] || [];
    const epssVals = it.cves.map((c) => state.epss.get(c)?.epss).filter((x) => x != null);
    const out = {
      ...it,
      productLabel: p?.label || ({ 'fortinet-other': 'Weitere Fortinet-Produkte', 'fortinet-info': 'Fortinet-Hinweis (Drittsoftware)' }[it.productId] || it.productId),
      inUse: Boolean(p && (p.inUse || customers.length)),
      customers: customers.map((c) => ({ id: c.id, name: c.name, devices: c.devices.length, ticket: tickets[it.key]?.[String(c.id)] || null })),
      epss: epssVals.length ? Math.max(...epssVals) : null,
      status: status[it.key] || { status: 'new' },
    };
    out.priority = priority(out, now);
    return out;
  }).sort((a, b) => b.priority - a.priority);

  const products = settings.products.map((p) => {
    const cust = affected[p.id] || [];
    const mine = items.filter((i) => i.productId === p.id);
    return {
      id: p.id, vendor: p.vendor, label: p.label, inUse: Boolean(p.inUse || cust.length), fromAtera: Boolean(cust.length),
      customers: cust.length, devices: cust.reduce((s, c) => s + c.devices.length, 0),
      open: mine.filter((i) => ['new', 'progress'].includes(i.status.status)).length,
      exploited: mine.filter((i) => i.exploited && ['new', 'progress'].includes(i.status.status)).length,
      customerList: cust.map((c) => ({ id: c.id, name: c.name, devices: c.devices.map((d) => d.name) })),
    };
  });

  return {
    generatedAt: now, fetchedAt: state.at || null, loading: Boolean(state.refreshing), days,
    sources: Object.entries(SOURCES).map(([id, label]) => ({
      id, label, at: state.sources[id]?.at || null, error: state.sources[id]?.error || null, count: state.sources[id]?.count ?? null,
    })),
    ateraError: ov.error || null,
    products, items,
  };
}

/** Kurzfassung für die Startseite */
export async function securitySummary() {
  if (!state.at) return null;
  const r = await securityReport({ days: 30 });
  const open = r.items.filter((i) => i.inUse && ['new', 'progress'].includes(i.status.status));
  return {
    exploited: open.filter((i) => i.exploited).length,
    critical: open.filter((i) => i.severity === 'critical').length,
    top: open.slice(0, 3).map((i) => ({ title: i.title, vendor: i.vendor, exploited: i.exploited, customers: i.customers.length })),
  };
}

export function startBackgroundRefresh() {
  setTimeout(() => refresh().catch(() => {}), 5000).unref();
  setInterval(() => refresh().catch(() => {}), config.security.refreshHours * 3600e3).unref();
}
