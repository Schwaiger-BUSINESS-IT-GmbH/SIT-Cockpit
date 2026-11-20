// Prüfskript vor dem Echtbetrieb – NUR LESEND, schreibt nichts in weclapp oder Atera.
//
//   PowerShell:  $env:WECLAPP_TOKEN="<dein-token>"; npm run check
//   Bash:        WECLAPP_TOKEN=<dein-token> npm run check
//
// Liest WECLAPP_TENANT / WECLAPP_BASE_URL und ATERA_API_KEY aus der .env.
// Prüft: Zugang, API-Schema des Mandanten (Felder, Endpunkte, Statuswerte),
// Rechte für die Dashboard-Bereiche, Artikel des Angebotsboards,
// Atera-Daten und die Zuordnung Atera-Kunde -> weclapp-Kunde.
// Schlüssel und Tokens werden nie ausgegeben.
import fs from 'node:fs';

try { process.loadEnvFile(); } catch { /* keine .env */ }

const env = process.env;
const tenant = (env.WECLAPP_TENANT || '').replace(/^https?:\/\//, '').replace(/\.weclapp\.com.*$/, '').replace(/\/+$/, '');
const WC = (env.WECLAPP_BASE_URL || (tenant ? `https://${tenant}.weclapp.com/webapp/api/v2` : '')).replace(/\/$/, '');
const TOKEN = env.WECLAPP_TOKEN || '';
const AT = (env.ATERA_BASE_URL || 'https://app.atera.com/api/v3').replace(/\/$/, '');
const AKEY = env.ATERA_API_KEY || '';
const FIELD = env.ATERA_CUSTOMER_NUMBER_FIELD || 'weclapp-Kundennummer';
const board = JSON.parse(fs.readFileSync(new URL('../config/angebotsboard.json', import.meta.url), 'utf8'));

// ---------- Ausgabe ----------
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const sum = { ok: 0, warn: 0, fail: 0 };
const ok = (m) => { sum.ok++; console.log(`  ${c(32, '✔')} ${m}`); };
const warn = (m) => { sum.warn++; console.log(`  ${c(33, '⚠')} ${m}`); };
const fail = (m) => { sum.fail++; console.log(`  ${c(31, '✖')} ${m}`); };
const info = (m) => console.log(`    ${c(90, m)}`);
const head = (m) => console.log(`\n${c(1, m)}`);

// ---------- HTTP (nur GET) ----------
async function wget(path, query = {}) {
  const url = new URL(WC + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { AuthenticationToken: TOKEN, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw Object.assign(new Error((body && (body.detail || body.title)) || `HTTP ${res.status}`), { status: res.status });
  return body && Array.isArray(body.result) ? body.result : body?.result ?? body;
}
async function aget(path, query = {}) {
  const url = new URL(AT + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const auth = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(AKEY) ? { Authorization: `Bearer ${AKEY}` } : { 'X-API-KEY': AKEY };
  const res = await fetch(url, { headers: { ...auth, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}
const why = (e) => (e.status === 401 ? 'Token/Schlüssel abgelehnt (401)' : e.status === 403 ? 'keine Berechtigung (403)' : e.message);

// Felder eines Schema-Typs inkl. geerbter (weclapp nutzt allOf + $ref)
export function schemaProps(schema, schemas, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop().toLowerCase();
    if (seen.has(name)) return [];
    seen.add(name);
    return schemaProps(schemas[name], schemas, seen);
  }
  return [
    ...Object.keys(schema.properties || {}),
    ...['allOf', 'anyOf', 'oneOf'].flatMap((k) => (schema[k] || []).flatMap((x) => schemaProps(x, schemas, seen))),
  ];
}

// ---------- weclapp ----------
async function checkWeclapp() {
  head('weclapp');
  if (!WC) return fail('WECLAPP_TENANT bzw. WECLAPP_BASE_URL fehlt in der .env');
  if (!TOKEN) return fail('WECLAPP_TOKEN nicht gesetzt (persönlichen API-Token als Umgebungsvariable übergeben)');
  info(`API: ${WC}`);

  try {
    const u = await wget('/user/currentUser');
    ok(`Anmeldung als ${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.email}`);
  } catch (e) {
    return fail(`Anmeldung fehlgeschlagen: ${why(e)}`);
  }

  // Schema des Mandanten
  let schemas = null, paths = null;
  try {
    const res = await fetch(`${WC}/meta/openapi.json`, { headers: { AuthenticationToken: TOKEN }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    schemas = Object.fromEntries(Object.entries(doc.components?.schemas || doc.definitions || {}).map(([k, v]) => [k.toLowerCase(), v]));
    paths = doc.paths || {};
    ok(`API-Schema geladen (${Object.keys(schemas).length} Typen, ${Object.keys(paths).length} Endpunkte)`);
  } catch (e) {
    warn(`API-Schema (openapi.json) nicht abrufbar: ${e.message} – Feldprüfung übersprungen`);
  }

  if (schemas) {
    head('weclapp · Felder, die das Cockpit verwendet');
    const need = {
      quotation: ['customerId', 'quotationNumber', 'quotationDate', 'validTo', 'status', 'netAmount', 'commission', 'recordComment', 'quotationItems'],
      quotationItem: ['articleId', 'quantity', 'unitPrice', 'manualUnitPrice', 'positionNumber', 'title', 'description'],
      salesOrder: ['orderNumber', 'orderDate', 'customerId', 'netAmount', 'status', 'quotationId'],
      salesInvoice: ['invoiceNumber', 'customerId', 'dueDate', 'grossAmount', 'paid', 'paymentStatus', 'status'],
      party: ['company', 'customer', 'customerNumber', 'partyType', 'email', 'phone', 'addresses'],
      contract: ['partyId', 'contractStatus', 'contractItems'],
      contractItem: ['interval', 'intervalType', 'netAmount', 'unitPrice', 'quantity'],
      ticket: ['ticketNumber', 'subject', 'partyId', 'ticketStatusId', 'lastModifiedDate'],
      article: ['articleNumber', 'name'],
    };
    for (const [entity, fields] of Object.entries(need)) {
      const s = schemas[entity.toLowerCase()];
      if (!s) { warn(`Typ „${entity}“ nicht im Schema gefunden (Modul nicht lizenziert oder keine Berechtigung?)`); continue; }
      const props = schemaProps(s, schemas);
      const missing = fields.filter((f) => !props.includes(f));
      if (missing.length) fail(`${entity}: Felder fehlen: ${missing.join(', ')}`);
      else ok(`${entity}: alle ${fields.length} Felder vorhanden`);
    }

    head('weclapp · Endpunkte');
    const has = (re) => Object.keys(paths).some((p) => re.test(p));
    const eps = [
      [/^\/quotation\/id\/\{[^}]+\}\/accept$/, 'Angebot annehmen (→ Auftrag)'],
      [/^\/quotation\/id\/\{[^}]+\}\/updateStatus$/, 'Angebotsstatus setzen'],
      [/^\/document\/upload$/, 'Dokument hochladen (PDF anhängen)'],
      [/^\/ticket\/count$/, 'Tickets zählen'],
      [/^\/attendance\//, 'Arbeitszeit (SIT-Time)'],
    ];
    for (const [re, label] of eps) (has(re) ? ok : fail)(`${label}`);

    head('weclapp · Statuswerte');
    const enums = Object.values(schemas).filter((s) => Array.isArray(s.enum)).map((s) => s.enum.map(String));
    const enumWith = (...vals) => enums.find((e) => vals.every((v) => e.includes(v)));
    const checkEnum = (label, vals) => {
      const e = enumWith(...vals.slice(0, 2));
      if (!e) return warn(`${label}: Aufzählung nicht gefunden`);
      const miss = vals.filter((v) => !e.includes(v));
      miss.length ? fail(`${label}: unbekannte Werte ${miss.join(', ')}`) : ok(`${label}: ${vals.join(', ')}`);
    };
    checkEnum('Angebotsstatus', ['OPEN', 'ENTRY_COMPLETED', 'INQUIRED', 'ACCEPTED']);
    checkEnum('Auftragsstatus', ['ORDER_ENTRY_IN_PROGRESS', 'ORDER_CONFIRMATION_PRINTED', 'CANCELLED']);
    checkEnum('Rechnungsstatus', ['DOCUMENT_CREATED', 'OPEN_ITEM_CREATED']);
    checkEnum('Zahlungsstatus', ['OPEN', 'PAID']);
    checkEnum('Angebot annehmen als', ['SALES_ORDER', 'CONTRACT']);
    checkEnum('Vertragsintervall', ['MONTHLY', 'YEARLY']);
  }

  head('weclapp · Rechte für die Cockpit-Bereiche (Lesezugriff)');
  const probes = [
    ['Angebote', '/quotation', { pageSize: 1, 'status-in': JSON.stringify(['OPEN', 'ENTRY_COMPLETED', 'INQUIRED']) }],
    ['Aufträge', '/salesOrder', { pageSize: 1 }],
    ['Rechnungen', '/salesInvoice', { pageSize: 1, 'paid-eq': false }],
    ['Verträge', '/contract', { pageSize: 1 }],
    ['Tickets', '/ticket', { pageSize: 1 }],
    ['Kunden', '/party', { pageSize: 1, 'customer-eq': true }],
    ['Zeiterfassung', '/timeRecord', { pageSize: 1 }],
    ['Artikel', '/article', { pageSize: 1 }],
  ];
  for (const [label, path, q] of probes) {
    try { await wget(path, q); ok(label); } catch (e) { (e.status === 403 ? warn : fail)(`${label}: ${why(e)}${e.status === 403 ? ' – dieser Bereich bleibt für dich leer' : ''}`); }
  }

  if (env.WECLAPP_CONTRACTS_TOKEN) {
    try {
      const url = new URL(WC + '/contract'); url.searchParams.set('pageSize', '1'); url.searchParams.set('contractStatus-eq', 'ACTIVE');
      const res = await fetch(url, { headers: { AuthenticationToken: env.WECLAPP_CONTRACTS_TOKEN, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      res.ok ? ok('Vertrags-Token (WECLAPP_CONTRACTS_TOKEN) darf Verträge lesen') : fail(`Vertrags-Token abgelehnt (HTTP ${res.status})`);
    } catch (e) { fail(`Vertrags-Token: ${e.message}`); }
  } else info('Kein WECLAPP_CONTRACTS_TOKEN gesetzt – Verträge mit den Rechten des Benutzers');

  try {
    const st = await wget('/ticketStatus', { pageSize: 200 });
    const re = env.TICKET_HIDDEN_STATUS_PATTERN ?? '^(geschlossen|abgeschlossen|erledigt|closed|storniert)$';
    const closed = st.filter((s) => re && new RegExp(re, 'i').test(s.name || '')).map((s) => s.name);
    closed.length ? ok(`Ticketstatus „geschlossen“ erkannt: ${closed.join(', ')}`) : warn(`Kein Ticketstatus als geschlossen erkannt – offene Tickets werden zu hoch gezählt. Vorhanden: ${st.map((s) => s.name).join(', ')}`);
  } catch (e) { warn(`Ticketstatus nicht lesbar: ${why(e)}`); }

  head('weclapp · Artikel des Angebotsboards (Board-Position → weclapp-Artikel)');
  const skus = [...new Set([
    ...board.products.map((p) => p.sku),
    ...Object.values(board.sla.skuBase), ...Object.values(board.sla.skuUser),
    board.sla.site.sku, board.sla.setup.sku, ...Object.values(board.sla.reviews).map((r) => r.sku), board.projectSku,
  ])];
  try {
    // Zuordnung aus dem Board (liegt im Datenordner – auf Azure /home/data, lokal ./data)
    const dataDir = env.DATA_DIR || new URL('../data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    let mapping = {};
    try { mapping = JSON.parse(fs.readFileSync(`${dataDir.replace(/\/$/, '')}/article-map.json`, 'utf8')); } catch { /* noch keine Zuordnung */ }
    const mappedIds = [...new Set(skus.filter((k) => mapping[k]?.id).map((k) => mapping[k].id))];
    const byId = new Map();
    for (let i = 0; i < mappedIds.length; i += 50) {
      const rows = await wget('/article', { 'id-in': JSON.stringify(mappedIds.slice(i, i + 50)), properties: 'id,articleNumber,name,active', pageSize: 100 });
      for (const a of rows) byId.set(String(a.id), a);
    }
    const rest = skus.filter((k) => !mapping[k]?.id);
    const byNumber = new Map();
    for (let i = 0; i < rest.length; i += 50) {
      const rows = await wget('/article', { 'articleNumber-in': JSON.stringify(rest.slice(i, i + 50)), properties: 'id,articleNumber,name,active', pageSize: 100 });
      for (const a of rows) byNumber.set(a.articleNumber, a);
    }
    const mapped = skus.filter((k) => mapping[k]?.id && byId.has(mapping[k].id));
    const broken = skus.filter((k) => mapping[k]?.id && !byId.has(mapping[k].id));
    const direct = rest.filter((k) => byNumber.has(k));
    const missing = rest.filter((k) => !byNumber.has(k));
    const inactive = [...byId.values(), ...byNumber.values()].filter((a) => a.active === false).map((a) => a.articleNumber);
    info(`Zuordnung: ${Object.keys(mapping).length ? `${dataDir}article-map.json` : 'noch keine (im Board unter „Artikelzuordnung“ anlegen)'}`);
    if (mapped.length) ok(`${mapped.length} Positionen einem weclapp-Artikel zugeordnet`);
    if (direct.length) ok(`${direct.length} Positionen über gleiche Artikelnummer gefunden`);
    if (broken.length) fail(`Zugeordneter Artikel existiert nicht mehr: ${broken.join(', ')}`);
    if (missing.length) warn(`${missing.length} von ${skus.length} Positionen ohne weclapp-Artikel: ${missing.join(', ')} – Angebote mit diesen Positionen können nicht angelegt werden`);
    if (!missing.length && !broken.length) ok(`Alle ${skus.length} Positionen haben einen weclapp-Artikel`);
    if (inactive.length) warn(`Inaktive Artikel: ${inactive.join(', ')}`);
  } catch (e) { fail(`Artikelabgleich nicht möglich: ${why(e)}`); }
}

// ---------- Atera ----------
async function checkAtera() {
  head('Atera');
  if (!AKEY) return fail('ATERA_API_KEY fehlt in der .env');
  info(`API: ${AT}`);
  if (/^eyJ/.test(AKEY)) {
    try {
      const p = JSON.parse(Buffer.from(AKEY.split('.')[1], 'base64url'));
      const perms = String(p.apiPermissions || '').split(',').map((x) => x.split(':')[0]).filter(Boolean);
      const need = ['Customers', 'Agents', 'Alerts', 'CustomValues'];
      const missing = need.filter((n) => !perms.includes(n));
      missing.length ? fail(`Schlüssel ohne Rechte für: ${missing.join(', ')}`) : ok(`Neuer Schlüssel (Bearer) mit Rechten für ${need.join(', ')}`);
      if (p.exp) {
        const days = Math.round((p.exp * 1000 - Date.now()) / 864e5);
        (days > 30 ? ok : warn)(`Schlüssel gültig bis ${new Date(p.exp * 1000).toLocaleDateString('de-AT')} (${days} Tage)`);
      }
    } catch { warn('Schlüssel-Inhalt nicht lesbar'); }
  } else {
    warn('Alter Atera-Schlüssel (X-API-KEY) – Atera stellt auf neue Schlüssel um. Neuen Schlüssel erzeugen.');
  }
  let customers;
  try {
    const d = await aget('/customers', { page: 1, itemsInPage: 50 });
    customers = d.items || [];
    ok(`Zugriff ok – ${d.totalItemCount ?? customers.length} Kunden`);
  } catch (e) { return fail(`Zugriff fehlgeschlagen: ${why(e)}`); }

  try {
    const d = await aget('/agents', { page: 1, itemsInPage: 50 });
    const items = d.items || [];
    ok(`${d.totalItemCount ?? items.length} Geräte`);
    const withSeen = items.filter((a) => a.LastSeen || a.LastSeenDate).length;
    if (!items.length) warn('Keine Geräte geliefert');
    else if (withSeen === items.length) ok('Feld „LastSeen“ vorhanden (Offline-Dauer wird korrekt berechnet)');
    else warn(`„LastSeen“ fehlt bei ${items.length - withSeen} von ${items.length} Geräten – Offline-Dauer unbekannt, Server gelten dann sofort als kritisch`);
    const types = {};
    for (const a of items) types[a.OSType || '(leer)'] = (types[a.OSType || '(leer)'] || 0) + 1;
    info(`Gerätetypen (OSType): ${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const unknown = Object.keys(types).filter((t) => !/server|domain controller|work ?station|windows|mac|linux/i.test(t));
    if (unknown.length) warn(`Unbekannte Gerätetypen werden als „Gerät“ eingestuft: ${unknown.join(', ')}`);
    if (!items.some((a) => a.AppViewUrl)) warn('„AppViewUrl“ fehlt – Geräte-Links werden geschätzt');
  } catch (e) { fail(`Geräte nicht lesbar: ${why(e)}`); }

  try {
    const FW = /firewall|fortigate|forti|sophos|sonicwall|pfsense|opnsense|watchguard|fw/i;
    const counts = {};
    for (const [ep, label] of [['/devices/snmpdevices', 'SNMP'], ['/devices/genericdevices', 'Ping'], ['/devices/tcpdevices', 'TCP'], ['/devices/httpdevices', 'HTTP']]) {
      const d = await aget(ep, { page: 1, itemsInPage: 50 });
      const n = (d.items || []).filter((x) => x.Type === 'Firewall' || FW.test(`${x.Name || ''} ${x.Hostname || ''}`)).length;
      if (n) counts[label] = n;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    (total ? ok : warn)(`Firewalls erkannt (erste Seite je Gerätetyp): ${total}${total ? ` (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})` : ' – keine SNMP-Firewalls bzw. Geräte mit „Firewall“ im Namen'}`);
  } catch (e) { warn(`Netzwerkgeräte (Firewalls) nicht lesbar: ${why(e)}`); }

  try {
    const d = await aget('/alerts', { page: 1, itemsInPage: 50, alertStatus: 'Open' });
    const items = d.items || [];
    const sev = {}, cat = {};
    for (const a of items) { sev[a.Severity] = (sev[a.Severity] || 0) + 1; cat[a.AlertCategoryID] = (cat[a.AlertCategoryID] || 0) + 1; }
    ok(`${d.totalItemCount ?? items.length} offene Alerts`);
    if (items.length) info(`Schweregrade: ${Object.entries(sev).map(([k, v]) => `${k} ${v}`).join(', ')} · Kategorien: ${Object.entries(cat).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const archived = items.filter((a) => a.Archived).length;
    if (archived) warn(`${archived} archivierte Alerts trotz Filter „Open“ – werden im Cockpit ignoriert`);
    const backup = items.filter((a) => /backup|sicherung|veeam|acronis|datto/i.test(`${a.Title} ${a.Source}`)).length;
    info(`davon als Backup-Problem erkannt: ${backup}`);
  } catch (e) { fail(`Alerts nicht lesbar: ${why(e)}`); }

  // Zuordnung Atera -> weclapp (max. 25 Kunden, um die API zu schonen)
  head(`Zuordnung Atera → weclapp (Kundenfeld „${FIELD}“)`);
  const sample = customers.slice(0, 25);
  let withNr = 0, matched = 0, noMatch = [];
  // im Cockpit bestätigte Zuordnungen (Kundenzuordnung) zählen als Treffer
  let cmap = {};
  try { cmap = JSON.parse(fs.readFileSync(`${(env.DATA_DIR || new URL('../data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/$/, '')}/customer-map.json`, 'utf8')); } catch { /* keine */ }
  for (const cu of sample) {
    if (cmap[String(cu.CustomerID)]?.partyId) { matched++; continue; }
    let nr = null;
    try {
      const d = await aget(`/customvalues/customerfield/${encodeURIComponent(cu.CustomerID)}/${encodeURIComponent(FIELD)}`);
      const row = Array.isArray(d) ? d[0] : d;
      nr = row?.ValueAsString || row?.Value || null;
    } catch { /* Feld fehlt */ }
    if (nr) withNr++;
    if (WC && TOKEN) {
      try {
        const rows = nr
          ? await wget('/party', { 'customerNumber-eq': nr, properties: 'id', pageSize: 1 })
          : await wget('/party', { 'company-ilike': cu.CustomerName, properties: 'id', pageSize: 2 });
        if (rows.length === 1) matched++; else noMatch.push(`${cu.CustomerName}${nr ? ` (${nr})` : ''}`);
      } catch { noMatch.push(cu.CustomerName); }
    }
  }
  if (!sample.length) return;
  const viaCockpit = sample.filter((cu) => cmap[String(cu.CustomerID)]?.partyId).length;
  info(`${viaCockpit} über die Kundenzuordnung im Cockpit, ${withNr} über das Atera-Feld`);
  if (WC && TOKEN) {
    (matched === sample.length ? ok : warn)(`${matched} von ${sample.length} Kunden in weclapp gefunden`);
    if (noMatch.length) info(`ohne Treffer: ${noMatch.slice(0, 10).join(' · ')}${noMatch.length > 10 ? ' …' : ''} → im Cockpit unter „Kunden & Geräte → Kundenzuordnung weclapp“ verknüpfen`);
  }
}

// ---------- Start ----------
console.log(c(1, 'SIT-Cockpit · Prüfung vor dem Echtbetrieb (nur lesend)'));
await checkWeclapp().catch((e) => fail(`weclapp-Prüfung abgebrochen: ${e.message}`));
await checkAtera().catch((e) => fail(`Atera-Prüfung abgebrochen: ${e.message}`));
console.log(`\n${c(1, 'Ergebnis:')} ${c(32, `${sum.ok} ok`)} · ${c(33, `${sum.warn} Hinweise`)} · ${c(31, `${sum.fail} Fehler`)}`);
if (sum.fail) console.log('Fehler zuerst beheben – sonst schlagen Angebot, Auftrag oder Kundenansicht im Echtbetrieb fehl.');
process.exitCode = sum.fail ? 1 : 0; // kein process.exit(): vermeidet einen Node-Absturz unter Windows bei offenen Verbindungen
