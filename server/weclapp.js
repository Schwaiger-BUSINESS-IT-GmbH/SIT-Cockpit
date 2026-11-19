// Schlanker weclapp-REST-Client. Jeder Aufruf läuft mit dem persönlichen
// API-Token des angemeldeten Users – so gelten seine weclapp-Rechte und
// die Zeiten werden automatisch auf ihn gebucht.
import { config } from './config.js';

export class WeclappError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function request(token, method, path, { query, body } = {}) {
  const url = new URL(config.weclappBaseUrl.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      AuthenticationToken: token,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    let msg =
      (data && (data.detail || data.title || data.message || data.error)) ||
      `weclapp antwortet mit HTTP ${res.status}`;
    // weclapp liefert Details zu Validierungsfehlern in validationErrors[]
    // (v2 teils auch in messages[] bzw. errors[])
    const ve = data && [data.validationErrors, data.messages, data.errors].find((x) => Array.isArray(x) && x.length);
    if (ve) {
      msg += ': ' + ve.map((v) => [v.location || v.field || v.property || v.path, v.message || v.detail || v.title].filter(Boolean).join(' – ')).join('; ');
    } else if (data && data.detail && data.title && data.detail !== msg) {
      msg = `${data.title}: ${data.detail}`;
    }
    throw new WeclappError(res.status, msg, data);
  }
  return data;
}

export const unwrap = (d) => (d && Array.isArray(d.result) ? d.result : d?.result ?? d);

// ---------- User ----------
export async function currentUser(token) {
  const u = unwrap(await request(token, 'GET', '/user/currentUser'));
  return {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.email,
    email: u.email,
  };
}

// ---------- Tickets ----------
const TICKET_PROPS = 'id,ticketNumber,subject,partyId,ticketStatusId,assignedUserId,lastModifiedDate';

async function partyNames(token, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  try {
    const rows = unwrap(await request(token, 'GET', '/party', {
      query: { 'id-in': JSON.stringify(uniq), properties: 'id,company,firstName,lastName', pageSize: 100 },
    }));
    return Object.fromEntries(rows.map((p) => [
      p.id, p.company || [p.firstName, p.lastName].filter(Boolean).join(' '),
    ]));
  } catch {
    return {}; // Kundennamen sind nur Komfort – Suche soll nicht daran scheitern
  }
}

async function statusNames(token) {
  try {
    const rows = unwrap(await request(token, 'GET', '/ticketStatus', { query: { pageSize: 100 } }));
    return Object.fromEntries(rows.map((s) => [s.id, s.name]));
  } catch {
    return {};
  }
}

let statusCache = { at: 0, map: {} };
async function cachedStatusNames(token) {
  if (Date.now() - statusCache.at > 10 * 60 * 1000) {
    statusCache = { at: Date.now(), map: await statusNames(token) };
  }
  return statusCache.map;
}

// Geschlossene Tickets ausblenden: per Status-Name (Standard) oder expliziten Status-IDs
function filterHidden(rows, statuses) {
  const re = config.hiddenStatusPattern ? new RegExp(config.hiddenStatusPattern, 'i') : null;
  return rows.filter((t) => {
    const id = String(t.ticketStatusId ?? '');
    if (config.hiddenTicketStatusIds.includes(id)) return false;
    if (re && re.test(statuses[id] || '')) return false;
    return true;
  });
}

async function findPartyIds(token, term) {
  if (term.length < 2) return [];
  const q = (field) => request(token, 'GET', '/party', {
    query: { [`${field}-ilike`]: `%${term}%`, properties: 'id', pageSize: 50 },
  }).then(unwrap).catch(() => []);
  const [byCompany, byLastName] = await Promise.all([q('company'), q('lastName')]);
  return [...new Set([...byCompany, ...byLastName].map((p) => p.id))].slice(0, 50);
}

export async function searchTickets(token, { q, mine, userId }) {
  const base = { properties: TICKET_PROPS, sort: '-lastModifiedDate', pageSize: 60 };
  if (mine && userId) base['assignedUserId-eq'] = userId;

  let rows;
  const term = (q || '').trim();
  if (!term) {
    rows = unwrap(await request(token, 'GET', '/ticket', { query: base }));
  } else {
    // Zwei Abfragen (Nummer + Betreff) und zusammenführen – funktioniert in v1 und v2
    // Nummer, Betreff und Kundenname (Firma bzw. Nachname) parallel suchen und zusammenführen
    const partyIds = await findPartyIds(token, term);
    const [byNumber, bySubject, byCustomer] = await Promise.all([
      request(token, 'GET', '/ticket', { query: { ...base, 'ticketNumber-ilike': `%${term}%` } }).then(unwrap).catch(() => []),
      request(token, 'GET', '/ticket', { query: { ...base, 'subject-ilike': `%${term}%` } }).then(unwrap),
      partyIds.length
        ? request(token, 'GET', '/ticket', { query: { ...base, 'partyId-in': JSON.stringify(partyIds) } }).then(unwrap).catch(() => [])
        : Promise.resolve([]),
    ]);
    const seen = new Set();
    rows = [...byNumber, ...bySubject, ...byCustomer]
      .filter((t) => (seen.has(t.id) ? false : seen.add(t.id)))
      .sort((a, b) => (Number(b.lastModifiedDate) || 0) - (Number(a.lastModifiedDate) || 0));
  }
  const statuses = await cachedStatusNames(token);
  rows = filterHidden(rows, statuses).slice(0, 25);
  const parties = await partyNames(token, rows.map((t) => t.partyId));
  return rows.map((t) => ({
    id: t.id,
    number: t.ticketNumber,
    subject: t.subject,
    customer: parties[t.partyId] || '',
    status: statuses[t.ticketStatusId] || '',
  }));
}

// ---------- Artikel (Dienstleistungen) ----------
export async function serviceArticles(token) {
  const query = {
    properties: 'id,articleNumber,name,articleType,active',
    sort: 'name',
    pageSize: 200,
    'active-eq': true,
  };
  if (config.articleType) query['articleType-eq'] = config.articleType;
  if (config.articleNumbers.length) query['articleNumber-in'] = JSON.stringify(config.articleNumbers);
  const rows = unwrap(await request(token, 'GET', '/article', { query }));
  return rows.map((a) => ({ id: a.id, number: a.articleNumber, name: a.name }));
}

// ---------- Schema des Mandanten (openapi.json) ----------
// Wird einmal geladen und gecacht. Damit schicken wir nur Felder, die es
// im Mandanten wirklich gibt (v2: Zeit hängt an der Aufgabe, nicht am Ticket).
let schemaCache = null;
async function loadSchema(token) {
  if (schemaCache && Date.now() - schemaCache.at < 6 * 3600e3) return schemaCache.map;
  let map = null;
  try {
    const origin = new URL(config.weclappBaseUrl).origin;
    const ver = /\/v1\/?$/.test(config.weclappBaseUrl) ? 'v1' : 'v2';
    const res = await fetch(`${origin}/webapp/api/${ver}/meta/openapi.json`, {
      headers: { AuthenticationToken: token }, signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const doc = await res.json();
      const sch = doc.components?.schemas || doc.definitions || {};
      // weclapp v2 setzt Typen aus Bausteinen zusammen (allOf + $ref) -> geerbte Felder mitlesen
      const lower = Object.fromEntries(Object.entries(sch).map(([k, v]) => [k.toLowerCase(), v]));
      const props = (x, seen = new Set()) => {
        if (!x || typeof x !== 'object') return [];
        if (x.$ref) {
          const n = x.$ref.split('/').pop().toLowerCase();
          if (seen.has(n)) return [];
          seen.add(n);
          return props(lower[n], seen);
        }
        return [...Object.keys(x.properties || {}), ...['allOf', 'anyOf', 'oneOf'].flatMap((k) => (x[k] || []).flatMap((y) => props(y, seen)))];
      };
      map = {};
      for (const k of Object.keys(lower)) map[k] = [...new Set(props(lower[k]))];
    }
  } catch { /* ohne Schema weiter */ }
  schemaCache = { at: Date.now(), map };
  return map;
}
async function hasField(token, entity, field) {
  const map = await loadSchema(token);
  const props = map?.[entity.toLowerCase()];
  return props ? props.includes(field) : null; // null = unbekannt
}

// ---------- Aufgaben eines Tickets ----------
// weclapp v2: Zeiten werden auf eine Aufgabe (Dienstleistungsaufgabe) des Tickets gebucht.
const taskTitle = (t) => t.subject || t.title || t.name || `Aufgabe ${t.taskNumber || t.number || t.id}`;

async function findTicketTasks(token, ticketId) {
  const tries = [
    { 'ticketId-eq': ticketId },
    { 'entityReferences.entityId-eq': ticketId },
    { 'entityId-eq': ticketId },
  ];
  const log = [];
  for (const q of tries) {
    try {
      const rows = unwrap(await request(token, 'GET', '/task', { query: { ...q, pageSize: 50 } })) || [];
      // Plausibilität: bei entityReferences-Filtern nur Aufgaben behalten, die wirklich das Ticket referenzieren
      const ok = rows.filter((t) =>
        String(t.ticketId) === String(ticketId) ||
        (t.entityReferences || []).some((r) => String(r.entityId) === String(ticketId)) ||
        String(t.entityId) === String(ticketId));
      log.push({ filter: Object.keys(q)[0], count: rows.length, matching: ok.length });
      if (ok.length) return { tasks: ok, log };
    } catch (e) {
      log.push({ filter: Object.keys(q)[0], error: e.message, status: e.status });
    }
  }
  return { tasks: [], log };
}

async function articleNames(token, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  try {
    const rows = unwrap(await request(token, 'GET', '/article', {
      query: { 'id-in': JSON.stringify(uniq), properties: 'id,articleNumber,name', pageSize: 100 },
    }));
    return Object.fromEntries(rows.map((a) => [a.id, `${a.name}${a.articleNumber ? ` (${a.articleNumber})` : ''}`]));
  } catch { return {}; }
}

// Bearbeiter einer Aufgabe (v2: assignees[] mit userId) – null = Feld unbekannt
const assigneeKey = (t) => Object.keys(t || {}).find((k) => /assignee/i.test(k) && Array.isArray(t[k]));
function taskAssigneeIds(t) {
  const k = assigneeKey(t);
  if (!k) return null;
  return t[k].map((a) => String(typeof a === 'object' ? a.userId ?? a.id : a)).filter(Boolean);
}

export async function ticketTasks(token, ticketId) {
  const { tasks } = await findTicketTasks(token, ticketId);
  const arts = await articleNames(token, tasks.map((t) => t.articleId));
  const names = await userNames(token, tasks.flatMap((t) => taskAssigneeIds(t) || []));
  return tasks.map((t) => ({
    assignees: taskAssigneeIds(t)?.map((id) => ({ id, name: names[id] || `User ${id}` })) ?? null,
    id: t.id,
    title: taskTitle(t),
    number: t.taskNumber || t.number || '',
    article: arts[t.articleId] || '',
    // ohne Dienstleistungsartikel/Auftragsposition lässt weclapp keine abrechenbare Zeit zu
    hasArticle: Boolean(t.articleId || t.orderItemId),
    done: /done|closed|completed|erledigt/i.test(String(t.taskStatus || t.status || '')),
  }));
}

// Dienstleistungsartikel an einer Aufgabe hinterlegen (damit abrechenbar gebucht werden kann).
// Liefert eine Undo-Funktion, falls die anschließende Buchung scheitert.
export async function setTaskArticle(token, taskId, articleId) {
  const path = `/task/id/${encodeURIComponent(taskId)}`;
  const task = unwrap(await request(token, 'GET', path));
  if (task.articleId || task.orderItemId) return { changed: false, undo: async () => {} };
  const updated = unwrap(await request(token, 'PUT', path, { body: { ...task, articleId: String(articleId) } }));
  return {
    changed: true,
    undo: async () => {
      try {
        const cur = unwrap(await request(token, 'GET', path));
        await request(token, 'PUT', path, { body: { ...cur, articleId: null } });
      } catch (e) { console.error('Artikel an Aufgabe konnte nicht zurückgesetzt werden:', e.message); }
    },
    task: updated,
  };
}

// Benutzer als Bearbeiter zur Aufgabe hinzufügen (weclapp verlangt: Zeit nur von Bearbeitern der Aufgabe)
export async function addTaskAssignee(token, taskId, userId) {
  const path = `/task/id/${encodeURIComponent(taskId)}`;
  const task = unwrap(await request(token, 'GET', path));
  const key = assigneeKey(task) || 'assignees';
  const list = task[key] || [];
  if ((taskAssigneeIds(task) || []).includes(String(userId))) return { changed: false, undo: async () => {} };
  await request(token, 'PUT', path, { body: { ...task, [key]: [...list, { userId: String(userId) }] } });
  return {
    changed: true,
    undo: async () => {
      try {
        const cur = unwrap(await request(token, 'GET', path));
        const k = assigneeKey(cur) || key;
        await request(token, 'PUT', path, { body: { ...cur, [k]: (cur[k] || []).filter((a) => String(a?.userId ?? a?.id ?? a) !== String(userId)) } });
      } catch (e) { console.error('Bearbeiter konnte nicht entfernt werden:', e.message); }
    },
  };
}

// ---------- Leistungsorte ----------
let placesCache = null;
export async function placesOfService(token) {
  if (placesCache && Date.now() - placesCache.at < 3600e3) return placesCache.rows;
  let rows = [];
  try {
    rows = (unwrap(await request(token, 'GET', '/placeOfService', { query: { pageSize: 100 } })) || [])
      .filter((p) => p.active !== false)
      .map((p) => ({ id: p.id, name: p.name || p.description || p.id }));
  } catch { rows = []; }
  placesCache = { at: Date.now(), rows };
  return rows;
}

// ---------- Artikel (Fallback, falls es keine Aufgaben gibt) ----------
// weclapp v2: bewährtes Verhalten AUSDRÜCKLICH festgelegt statt aus dem Schema abgeleitet.
// Das Schema listet ticketId/articleId zwar an timeRecord, der Mandant lehnt sie beim
// Buchen aber ab ("Validation failed"); gebucht wird über die Aufgabe des Tickets.
// Früher ergab sich dieses Verhalten nur zufällig, weil geerbte Schemafelder (allOf)
// nicht gelesen wurden. So bleibt es stabil, auch wenn weclapp das Schemaformat ändert.
const V2_TIME_RECORD = Object.freeze({ taskId: false, ticketId: false, articleId: false });

export async function timeRecordNeedsTask(token) {
  if (!/\/v1\/?$/.test(config.weclappBaseUrl)) return { ...V2_TIME_RECORD };
  const withTask = await hasField(token, 'timeRecord', 'taskId');
  const withTicket = await hasField(token, 'timeRecord', 'ticketId');
  return { taskId: withTask, ticketId: withTicket, articleId: await hasField(token, 'timeRecord', 'articleId') };
}

// ---------- Zeiterfassung anlegen ----------
export async function createTimeRecord(token, r) {
  const f = await timeRecordNeedsTask(token);
  const body = {
    userId: r.userId,
    description: r.description,
    startDate: r.startDate, // Unix-Timestamp in ms
    durationSeconds: r.durationSeconds,
    // "billable" ist bei weclapp v2 read-only (kommt von Aufgabe/Artikel) → über die abrechenbare Dauer steuern
    billableDurationSeconds: r.billable ? r.durationSeconds : 0,
  };
  if (r.taskId) body.taskId = r.taskId;
  if (r.placeOfServiceId) body.placeOfServiceId = r.placeOfServiceId;
  // weclapp v2 bucht auf die Aufgabe – ticketId/articleId gibt es dort nicht (führt zu "Validation failed").
  // Nur ohne Aufgabe und nur wenn das Schema die Felder ausdrücklich kennt, werden sie mitgeschickt.
  if (!r.taskId) {
    if (r.ticketId && f.ticketId === true) body.ticketId = r.ticketId;
    if (r.articleId && f.articleId === true) body.articleId = r.articleId;
  }
  if (f.taskId && !body.taskId) {
    throw Object.assign(new Error('Bitte eine Aufgabe des Tickets wählen'), { status: 400 });
  }
  // Meldet weclapp ein Feld als read-only, lassen wir es weg und versuchen es erneut (max. 3x)
  for (let attempt = 0; ; attempt++) {
    try {
      return unwrap(await request(token, 'POST', '/timeRecord', { body }));
    } catch (e) {
      const ve = e.body?.validationErrors || e.body?.messages || [];
      const ro = ve.filter((v) => /read-?only/i.test(v.message || '') && v.location && v.location in body && !['taskId', 'userId', 'durationSeconds', 'startDate'].includes(v.location));
      if (!ro.length || attempt >= 3) throw e;
      for (const v of ro) delete body[v.location];
    }
  }
}

// ---------- Bereits gebuchte Zeiten eines Tickets ----------
const userNameCache = new Map();
async function userNames(token, ids) {
  const missing = [...new Set(ids.filter((id) => id && !userNameCache.has(String(id))))];
  if (missing.length) {
    try {
      const rows = unwrap(await request(token, 'GET', '/user', {
        query: { 'id-in': JSON.stringify(missing), properties: 'id,firstName,lastName,username', pageSize: 100 },
      }));
      for (const u of rows) {
        userNameCache.set(String(u.id), [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '');
      }
    } catch { /* Namen sind Komfort */ }
  }
  return Object.fromEntries(ids.map((id) => [id, userNameCache.get(String(id)) || '']));
}

function recordSeconds(r) {
  if (r.durationSeconds != null) return Number(r.durationSeconds) || 0;
  if (r.durationMinutes != null) return (Number(r.durationMinutes) || 0) * 60;
  if (r.endDate && r.startDate) return Math.max(0, (Number(r.endDate) - Number(r.startDate)) / 1000);
  return 0;
}

async function ticketRecords(token, ticketId) {
  const f = await timeRecordNeedsTask(token);
  if (f.ticketId !== false) {
    try {
      const rows = unwrap(await request(token, 'GET', '/timeRecord', { query: { 'ticketId-eq': ticketId, pageSize: 200 } })) || [];
      if (rows.length || f.ticketId === true) return rows;
    } catch (e) { if (f.ticketId === true) throw e; }
  }
  const { tasks } = await findTicketTasks(token, ticketId);
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id);
  try {
    return unwrap(await request(token, 'GET', '/timeRecord', { query: { 'taskId-in': JSON.stringify(ids), pageSize: 500 } })) || [];
  } catch {
    // Fallback: einzeln je Aufgabe
    const all = await Promise.all(ids.map((id) =>
      request(token, 'GET', '/timeRecord', { query: { 'taskId-eq': id, pageSize: 200 } }).then(unwrap).catch(() => [])));
    return all.flat();
  }
}

export async function ticketBookedTimes(token, ticketId, myUserId) {
  const rows = await ticketRecords(token, ticketId);
  rows.sort((a, b) => (Number(b.startDate) || 0) - (Number(a.startDate) || 0));
  const names = await userNames(token, rows.map((r) => r.userId));
  let total = 0; let mine = 0;
  const entries = rows.map((r) => {
    const sec = recordSeconds(r);
    const isMine = String(r.userId) === String(myUserId);
    total += sec; if (isMine) mine += sec;
    return {
      date: Number(r.startDate) || Number(r.createdDate) || null,
      user: names[r.userId] || '',
      mine: isMine,
      minutes: Math.round(sec / 60),
      billable: r.billable !== false,
      description: r.description || '',
    };
  });
  return { totalMinutes: Math.round(total / 60), mineMinutes: Math.round(mine / 60), count: rows.length, entries: entries.slice(0, 50) };
}

// ---------- Diagnose ----------
export async function timeRecordShape(token, ticketId) {
  const rows = unwrap(await request(token, 'GET', '/timeRecord', {
    query: { ...(ticketId ? { 'ticketId-eq': ticketId } : {}), pageSize: 1 },
  })) || [];
  const r = rows[0];
  return r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v])) : null;
}

export async function diagnoseTicket(token, ticketNumber) {
  const out = { version: 3 };
  const map = await loadSchema(token);
  out.schemaLoaded = !!map;
  if (map) {
    out.schemaTimeRecord = map.timerecord || null;
    out.schemaTask = map.task || null;
    out.schemaTicket = map.ticket || null;
  }
  try {
    const t = unwrap(await request(token, 'GET', '/ticket', { query: { 'ticketNumber-eq': ticketNumber, pageSize: 1 } }))?.[0];
    out.ticketFound = !!t;
    if (!t) return out;
    out.ticketId = t.id;
    out.ticketIdFields = Object.fromEntries(Object.entries(t).filter(([k, v]) => /Id$|Ids$/.test(k) && v != null));
    const found = await findTicketTasks(token, t.id);
    out.taskSearch = found.log;
    out.tasks = found.tasks.map((x) => ({ id: x.id, title: taskTitle(x), articleId: x.articleId, keys: Object.keys(x) }));
    const booked = await ticketBookedTimes(token, t.id, null);
    out.booked = { count: booked.count, totalMinutes: booked.totalMinutes };
    out.places = (await placesOfService(token)).length;
  } catch (e) { out.error = e.message; }
  return out;
}

// Diagnose: welche Dokument-Endpunkte bietet der Mandant? (für Foto-Upload)
export async function documentEndpoints(token) {
  const origin = new URL(config.weclappBaseUrl).origin;
  const ver = /\/v1\/?$/.test(config.weclappBaseUrl) ? 'v1' : 'v2';
  const res = await fetch(`${origin}/webapp/api/${ver}/meta/openapi.json`, { headers: { AuthenticationToken: token }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const doc = await res.json();
  const out = {};
  for (const [p, ops] of Object.entries(doc.paths || {})) {
    if (!/document/i.test(p)) continue;
    out[p] = Object.fromEntries(Object.entries(ops).filter(([m]) => /get|post|put|delete/i.test(m)).map(([m, op]) => [m,
      { params: (op.parameters || []).map((x) => x.name || x.$ref?.split('/').pop()), body: Object.keys(op.requestBody?.content || {}) }]));
  }
  return out;
}

// ---------- openapi.json (voll, gecacht) ----------
let openapiCache = null;
async function openapi(token) {
  if (openapiCache && Date.now() - openapiCache.at < 6 * 3600e3) return openapiCache.doc;
  const origin = new URL(config.weclappBaseUrl).origin;
  const ver = /\/v1\/?$/.test(config.weclappBaseUrl) ? 'v1' : 'v2';
  const res = await fetch(`${origin}/webapp/api/${ver}/meta/openapi.json`, { headers: { AuthenticationToken: token }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new WeclappError(res.status, `openapi.json: HTTP ${res.status}`);
  const doc = await res.json();
  openapiCache = { at: Date.now(), doc };
  return doc;
}
// Properties eines Schemas inkl. allOf/$ref auflösen
function schemaProps(doc, schema, seen = new Set()) {
  if (!schema) return {};
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    if (seen.has(name)) return {};
    seen.add(name);
    return schemaProps(doc, (doc.components?.schemas || doc.definitions || {})[name], seen);
  }
  let out = { ...(schema.properties || {}) };
  for (const part of [...(schema.allOf || []), ...(schema.oneOf || []), ...(schema.anyOf || [])]) out = { ...schemaProps(doc, part, seen), ...out };
  return out;
}
const propSummary = (doc, props) => Object.fromEntries(Object.entries(props).map(([k, v]) => {
  const t = v.$ref ? v.$ref.split('/').pop() : v.type === 'array' ? `array<${v.items?.$ref?.split('/').pop() || v.items?.type || '?'}>` : v.type || (v.allOf ? v.allOf.map((x) => x.$ref?.split('/').pop()).join('|') : '?');
  return [k, v.readOnly ? `${t} (ro)` : t];
}));

// Welche Arbeitszeit-/Abwesenheits-Endpunkte bietet der Mandant? (Diagnose)
export async function hrEndpoints(token, detail = false) {
  const doc = await openapi(token);
  const re = /absen|attend|presen|vacation|holiday|leave|workingtime|worktime|shift|timeaccount|clock|employee|personnel|staff|urlaub/i;
  const paths = {};
  for (const [p, ops] of Object.entries(doc.paths || {})) {
    if (!re.test(p)) continue;
    if (!detail) { paths[p] = Object.keys(ops).filter((m) => /get|post|put|patch|delete/i.test(m)); continue; }
    paths[p] = Object.fromEntries(Object.entries(ops).filter(([m]) => /get|post|put|patch|delete/i.test(m)).map(([m, op]) => {
      const bodySchema = Object.values(op.requestBody?.content || {})[0]?.schema;
      const resSchema = Object.values((op.responses?.['200'] || op.responses?.['201'] || {}).content || {})[0]?.schema;
      return [m, {
        params: (op.parameters || []).map((x) => (x.$ref ? x.$ref.split('/').pop() : `${x.name}${x.required ? '*' : ''}`)),
        body: bodySchema ? propSummary(doc, schemaProps(doc, bodySchema)) : null,
        response: resSchema ? Object.keys(schemaProps(doc, resSchema)) : null,
      }];
    }));
  }
  const schemas = {};
  for (const [k, v] of Object.entries(doc.components?.schemas || doc.definitions || {})) {
    if (re.test(k) || /^calendarEvent$/i.test(k)) schemas[k] = detail ? propSummary(doc, schemaProps(doc, v)) : Object.keys(schemaProps(doc, v));
    if (v.enum && re.test(k)) schemas[k] = v.enum;
  }
  return { paths, schemas, allPathCount: Object.keys(doc.paths || {}).length };
}

// ---------- Arbeitszeit in weclapp (/attendance) ----------
const tsOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d/.test(v) ? Date.parse(v) || Number(v) || null : null);
function pickTime(o, re) {
  for (const [k, v] of Object.entries(o || {})) if (re.test(k) && tsOf(v)) return tsOf(v);
  return null;
}
const START_RE = /^(start|begin|from|logOn|clockIn|checkIn)/i;
const END_RE = /^(end|until|to$|logOff|clockOut|checkOut)/i;

// Anwesenheit (weclapp) auf { state: off|work|break, start, breakStart, breakEnd } normalisieren
export function normalizeAttendance(a) {
  if (Array.isArray(a)) a = a[0];
  if (a && Array.isArray(a.result)) a = a.result[0];
  if (a && a.result && typeof a.result === 'object') a = a.result;
  if (!a || typeof a !== 'object' || !Object.keys(a).length) return { state: 'off' };
  const start = pickTime(a, START_RE);
  const end = pickTime(a, END_RE);
  const breaks = Object.values(a).find((v) => Array.isArray(v) && v.some((x) => x && typeof x === 'object' && pickTime(x, START_RE))) || [];
  const norm = breaks.map((x) => ({ start: pickTime(x, START_RE), end: pickTime(x, END_RE) })).filter((x) => x.start).sort((x, y) => x.start - y.start);
  const open = norm.find((x) => !x.end);
  const lastClosed = norm.filter((x) => x.end).at(-1);
  if (end && end <= Date.now()) return { state: 'off', start, end, id: a.id };
  return { state: open ? 'break' : 'work', start, breakStart: open?.start ?? null, breakEnd: lastClosed?.end ?? null, id: a.id };
}

export async function currentAttendance(token) {
  try {
    const d = await request(token, 'GET', '/attendance/currentAttendance');
    return normalizeAttendance(d);
  } catch (e) {
    if (e.status === 404 || e.status === 204) return { state: 'off' }; // nicht angemeldet
    throw e;
  }
}

// POST /attendance/<op> – Parameter/Body laut openapi.json des Mandanten
async function attendanceOp(token, op, userId) {
  let spec = null;
  try { spec = (await openapi(token)).paths?.[`/attendance/${op}`]?.post; } catch { /* ohne Spec */ }
  const params = (spec?.parameters || []).map((x) => x.name).filter(Boolean);
  const query = {};
  if (params.includes('userId')) query.userId = userId;
  let body;
  const bodySchema = spec && Object.values(spec.requestBody?.content || {})[0]?.schema;
  if (bodySchema) {
    body = {};
    let props = {};
    try { props = schemaProps(await openapi(token), bodySchema); } catch { /* egal */ }
    if ('userId' in props) body.userId = userId;
  } else if (!spec) {
    body = {};
  }
  return request(token, 'POST', `/attendance/${op}`, { query, body });
}

// Stempel-Aktion in weclapp ausführen, abhängig vom aktuellen weclapp-Zustand. Liefert den neuen Zustand.
export async function attendanceAction(token, action, userId) {
  const cur = await currentAttendance(token);
  const steps = {
    in: { off: ['logOn'], break: ['endBreak'], work: [] },
    resume: { off: ['logOn'], break: ['endBreak'], work: [] },
    pause: { off: [], break: [], work: ['startBreak'] },
    out: { off: [], break: ['endBreak', 'logOff'], work: ['logOff'] },
  }[action]?.[cur.state];
  if (!steps) throw Object.assign(new Error('Unbekannte Aktion'), { status: 400 });
  for (const op of steps) await attendanceOp(token, op, userId);
  return steps.length ? currentAttendance(token) : cur;
}

export async function attendanceDebug(token) {
  const out = {};
  try { out.currentAttendanceRaw = await request(token, 'GET', '/attendance/currentAttendance'); } catch (e) { out.currentAttendanceError = { status: e.status, message: e.message }; }
  out.normalized = normalizeAttendance(out.currentAttendanceRaw);
  try { out.latest = unwrap(await request(token, 'GET', '/attendance', { query: { pageSize: 3, sort: '-id' } })); } catch (e) { out.latestError = e.message; }
  return out;
}

// ---------- Fotos / Dokumente an Ticket hochladen ----------
// weclapp: POST /document/upload?entityName=ticket&entityId=..&name=..  (Binär-Body)
// Der genaue Pfad/Parametersatz wird aus dem openapi.json des Mandanten ermittelt.
let docSpecCache = null;
async function documentUploadSpec(token) {
  if (docSpecCache) return docSpecCache;
  let spec = { path: '/document/upload', params: ['entityName', 'entityId', 'name', 'description'], source: 'default' };
  try {
    const origin = new URL(config.weclappBaseUrl).origin;
    const ver = /\/v1\/?$/.test(config.weclappBaseUrl) ? 'v1' : 'v2';
    const res = await fetch(`${origin}/webapp/api/${ver}/meta/openapi.json`, { headers: { AuthenticationToken: token }, signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const doc = await res.json();
      const cand = Object.entries(doc.paths || {}).find(([p, ops]) => /^\/document\/upload$/i.test(p) && ops.post)
        || Object.entries(doc.paths || {}).find(([p, ops]) => /document.*upload/i.test(p) && ops.post);
      if (cand) {
        const params = (cand[1].post.parameters || []).map((x) => x.name).filter(Boolean);
        spec = { path: cand[0], params: params.length ? params : spec.params, source: 'openapi' };
      }
    }
  } catch { /* Default verwenden */ }
  docSpecCache = spec;
  return spec;
}

export function uploadTicketDocument(token, { ticketId, ...rest }) {
  return uploadDocument(token, { entityName: 'ticket', entityId: ticketId, ...rest });
}

export async function uploadDocument(token, { entityName, entityId, fileName, contentType, data, description }) {
  const spec = await documentUploadSpec(token);
  const url = new URL(config.weclappBaseUrl.replace(/\/$/, '') + spec.path);
  const set = (k, v) => { if (v != null && v !== '') url.searchParams.set(k, String(v)); };
  set('entityName', entityName);
  set('entityId', entityId);
  set('name', fileName);
  if (spec.params.includes('description')) set('description', description);
  const res = await fetch(url, {
    method: 'POST',
    headers: { AuthenticationToken: token, Accept: 'application/json', 'Content-Type': contentType || 'image/jpeg' },
    body: data,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.detail || body.title || body.message || body.error)) || `weclapp antwortet mit HTTP ${res.status}`;
    throw new WeclappError(res.status, `Dokument-Upload fehlgeschlagen: ${msg}`, { spec, body });
  }
  return unwrap(body);
}
