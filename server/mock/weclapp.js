// weclapp-Mock (API v2) für den Demo-Modus – Basis aus SIT-Time, erweitert um
// Vertriebsdaten (Angebote, Aufträge, Rechnungen, Managed-Service-Artikel).
// Gültige Tokens: "demo-rene", "demo-max"
import express from 'express';
import { registerSales } from './weclapp-sales.js';

const users = {
  'demo-rene': { id: '101', firstName: 'Rene', lastName: 'Schwaiger', email: 'rs@example.com' },
  'demo-max': { id: '102', firstName: 'Max', lastName: 'Muster', email: 'mm@example.com' },
};
const parties = [
  ['501', 'Bäckerei Huber GmbH', 'K-10001', 'Linz', 'Michael Huber', 'office@baeckerei-huber.example'],
  ['502', 'Steuerberatung Lang & Partner', 'K-10002', 'Wels', 'Mag. Eva Lang', 'kanzlei@lang-partner.example'],
  ['503', 'Autohaus Maier KG', 'K-10003', 'Steyr', 'Thomas Maier', 'service@autohaus-maier.example'],
  ['504', 'Tischlerei Gruber', 'K-10004', 'Freistadt', 'Josef Gruber', 'info@tischlerei-gruber.example'],
  ['505', 'Ordination Dr. Wimmer', 'K-10005', 'Linz', 'Dr. Sabine Wimmer', 'ordination@wimmer.example'],
  ['506', 'Hotel Seeblick GmbH', 'K-10006', 'Gmunden', 'Andrea Leitner', 'rezeption@seeblick.example'],
  ['507', 'Wagner & Söhne Bau GmbH', 'K-10007', 'Ried im Innkreis', 'Ing. Karl Wagner', 'office@wagner-bau.example'],
  ['508', 'Gemeindeamt Neukirchen', 'K-10008', 'Neukirchen', 'AL Petra Moser', 'gemeinde@neukirchen.example'],
  ['509', 'Rechtsanwaltskanzlei Dr. Pichler', 'K-10009', 'Linz', 'Dr. Martin Pichler', 'kanzlei@pichler.example'],
  ['510', 'Hofer Elektrotechnik e.U.', 'K-10010', 'Enns', 'Stefan Hofer', 'office@elektro-hofer.example'],
  ['511', 'Fitnessstudio Kraftwerk', 'K-10011', 'Linz', 'Lisa Berger', 'hallo@kraftwerk.example'],
].map(([id, company, customerNumber, city, contact, email]) => ({
  id, company, customerNumber, customer: true, partyType: 'ORGANIZATION', email,
  addresses: [{ city, street1: 'Hauptstraße 1', zipcode: '4020', countryCode: 'AT', primeAddress: true }],
  contactName: contact,
}));
const statuses = [
  { id: '1', name: 'Offen', positionNumber: 1, internalTicketStatus: 'UNASSIGNED' }, { id: '2', name: 'In Bearbeitung', positionNumber: 2, internalTicketStatus: 'ASSIGNED' }, { id: '3', name: 'Geschlossen', positionNumber: 3, internalTicketStatus: 'CLOSED' },
];
const now = Date.now();
const tickets = [
  ['T-10231', 'Drucker im Büro 2 druckt nicht', '501', '2', '101'],
  ['T-10232', 'Outlook-Postfach voll', '502', '1', '101'],
  ['T-10233', 'Neuer Arbeitsplatz Buchhaltung einrichten', '502', '1', '102'],
  ['T-10234', 'VPN-Verbindung bricht ab', '503', '2', '101'],
  ['T-10235', 'Firewall-Update einspielen', '503', '1', null],
  ['T-10236', 'Backup-Fehler NAS', '501', '3', '101'],
].map(([ticketNumber, subject, partyId, ticketStatusId, assignedUserId], i) => ({
  id: String(9000 + i), ticketNumber, subject, partyId, ticketStatusId, assignedUserId,
  lastModifiedDate: now - i * 3600e3,
}));
const articles = [
  { id: '701', articleNumber: 'DL-REMOTE', name: 'Remote-Support', articleType: 'SERVICE', active: true },
  { id: '702', articleNumber: 'DL-VORORT', name: 'Vor-Ort-Service', articleType: 'SERVICE', active: true },
  { id: '703', articleNumber: 'DL-PROJEKT', name: 'Projektarbeit', articleType: 'SERVICE', active: true },
  { id: '704', articleNumber: 'HW-MAUS', name: 'Maus USB', articleType: 'STORABLE', active: true },
];
const d = (days, h) => { const x = new Date(); x.setDate(x.getDate() - days); x.setHours(h, 0, 0, 0); return x.getTime(); };
// v2-Modell wie bei weclapp: Zeit hängt an einer Aufgabe, die Aufgabe am Ticket
const tasks = [
  { id: '6001', subject: 'Drucker prüfen', articleId: '701', entityReferences: [{ entityId: '9000', entityName: 'ticket' }] },
  { id: '6002', subject: 'Vor-Ort-Einsatz Drucker', articleId: '702', entityReferences: [{ entityId: '9000', entityName: 'ticket' }] },
  { id: '6003', subject: 'VPN analysieren', articleId: '701', entityReferences: [{ entityId: '9003', entityName: 'ticket' }] },
  { id: '6004', subject: 'Postfach bereinigen', articleId: '701', entityReferences: [{ entityId: '9001', entityName: 'ticket' }] },
  { id: '6006', version: '0', subject: 'Fremde Aufgabe', articleId: '701', assignees: [{ userId: '102' }], entityReferences: [{ entityId: '9001', entityName: 'ticket' }] },
  { id: '6005', version: '0', subject: 'Allgemein (ohne Artikel)', entityReferences: [{ entityId: '9001', entityName: 'ticket' }] },
];
const places = [{ id: '301', name: 'Remote' }, { id: '302', name: 'Vor Ort Service' }];
export const timeRecords = [
  { id: '79001', userId: '101', taskId: '6001', startDate: d(2, 9), durationSeconds: 1800, billable: true, description: 'Erstanalyse per Fernwartung, Spooler neu gestartet' },
  { id: '79002', userId: '102', taskId: '6002', startDate: d(1, 14), durationSeconds: 5400, billable: true, placeOfServiceId: '302', description: 'Vor Ort: Druckertreiber getauscht' },
  { id: '79003', userId: '101', taskId: '6003', startDate: d(3, 10), durationSeconds: 2700, billable: false, description: 'Rückruf, Logs gesichtet' },
];
const TR_FIELDS = ['id', 'version', 'billable', 'billableDurationSeconds', 'createdDate', 'description', 'durationSeconds', 'placeOfServiceId', 'startDate', 'taskId', 'userId'];

const auth = (req, res, next) => {
  const u = users[req.get('AuthenticationToken')];
  if (!u) return res.status(401).json({ title: 'Unauthorized', detail: 'invalid token' });
  req.user = u; next();
};

// Filter im weclapp-Stil: prop-eq/ne/ilike/in/notin/ge/gt/le/lt
function applyFilters(rows, q) {
  return rows.filter((r) => Object.entries(q).every(([k, v]) => {
    const m = k.match(/^(.+)-(eq|ne|ilike|in|notin|ge|gt|le|lt)$/);
    if (!m) return true;
    const [, prop, op] = m;
    if (prop === 'entityReferences.entityId') return (r.entityReferences || []).some((x) => String(x.entityId) === String(v));
    if (!(prop in r) && !['eq', 'notin', 'ne'].includes(op)) return false;
    const val = r[prop];
    if (op === 'eq') return String(val) === String(v);
    if (op === 'ne') return String(val) !== String(v);
    if (op === 'in') return JSON.parse(v).map(String).includes(String(val));
    if (op === 'notin') return !JSON.parse(v).map(String).includes(String(val));
    if (op === 'ge') return Number(val) >= Number(v);
    if (op === 'gt') return Number(val) > Number(v);
    if (op === 'le') return Number(val) <= Number(v);
    if (op === 'lt') return Number(val) < Number(v);
    const re = new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
    return re.test(String(val ?? ''));
  }));
}

const r = express.Router();
r.use(auth);

r.get('/user/currentUser', (req, res) => res.json({ result: req.user }));
r.get('/ticket', (req, res) => res.json({ result: applyFilters(tickets, req.query) }));
r.get('/party', (req, res) => res.json({ result: applyFilters(parties, req.query) }));
r.get('/ticketStatus', (req, res) => res.json({ result: statuses }));
r.get('/article', (req, res) => res.json({ result: applyFilters(articles, req.query) }));
r.get('/timeRecord', (req, res) => res.json({ result: applyFilters(timeRecords, req.query).sort((a, b) => b.startDate - a.startDate) }));
r.get('/task', (req, res) => {
  if (req.query['ticketId-eq']) return res.status(400).json({ title: 'Bad Request', detail: 'unknown property ticketId' });
  res.json({ result: applyFilters(tasks, req.query) });
});
r.get('/task/id/:id', (req, res) => {
  const t = tasks.find((x) => x.id === req.params.id);
  t ? res.json(t) : res.status(404).json({ title: 'Not Found' });
});
r.put('/task/id/:id', (req, res) => {
  const t = tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ title: 'Not Found' });
  Object.assign(t, req.body, { version: String(Number(t.version || 0) + 1) });
  console.log('[mock] Aufgabe aktualisiert:', JSON.stringify(t));
  res.json(t);
});
// Arbeitszeit (weclapp /attendance) – pro Token ein Zustand
const attendances = {};
const who = (req) => req.get('AuthenticationToken');
r.get('/attendance/currentAttendance', (req, res) => {
  const a = attendances[who(req)];
  if (!a || a.endDate) return res.status(404).json({ title: 'Not Found', detail: 'no current attendance' });
  res.json(a);
});
const attOp = (fn) => (req, res) => {
  const a = attendances[who(req)];
  const err = fn(req, a);
  if (err) return res.status(400).json({ title: 'validation failed', messages: [{ message: err }] });
  console.log('[mock] attendance', req.path, JSON.stringify(attendances[who(req)]));
  res.json(attendances[who(req)] || {});
};
r.post('/attendance/logOn', attOp((req, a) => {
  if (a && !a.endDate) return 'already logged on';
  attendances[who(req)] = { id: String(Date.now()), userId: '101', startDate: Date.now(), endDate: null, breaks: [] };
}));
r.post('/attendance/startBreak', attOp((req, a) => {
  if (!a || a.endDate) return 'not logged on';
  if (a.breaks.some((b) => !b.endDate)) return 'break already started';
  a.breaks.push({ startDate: Date.now(), endDate: null });
}));
r.post('/attendance/endBreak', attOp((req, a) => {
  const b = a?.breaks.find((x) => !x.endDate);
  if (!b) return 'no break';
  b.endDate = Date.now();
}));
r.post('/attendance/logOff', attOp((req, a) => {
  if (!a || a.endDate) return 'not logged on';
  if (a.breaks.some((b) => !b.endDate)) return 'end break first';
  a.endDate = Date.now();
}));
r.get('/placeOfService', (req, res) => res.json({ result: places }));
export const documents = [];
r.post('/document/upload', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  const { entityName, entityId, name } = req.query;
  if (!entityName || !entityId || !name) return res.status(400).json({ title: 'Bad Request', detail: 'entityName, entityId, name erforderlich' });
  const docu = { id: String(50000 + documents.length), entityName, entityId, name, size: req.body.length, contentType: req.get('content-type') };
  documents.push(docu);
  console.log('[mock] Dokument hochgeladen:', JSON.stringify(docu));
  res.status(201).json(docu);
});
// Schema-Auszug wie im echten Mandanten (für SIT-Time und das Prüfskript npm run check)
const P = (...f) => ({ properties: Object.fromEntries(f.map((x) => [x, {}])) });
r.get('/meta/openapi.json', (req, res) => res.json({ paths: {
  '/document/upload': { post: { parameters: [{ name: 'entityName' }, { name: 'entityId' }, { name: 'name' }, { name: 'description' }] } },
  '/quotation/id/{id}/accept': { post: {} }, '/quotation/id/{id}/updateStatus': { post: {} },
  '/ticket/count': { get: {} }, '/attendance/logOn': { post: {} },
}, components: { schemas: {
  timeRecord: { properties: Object.fromEntries(TR_FIELDS.map((f) => [f, {}])) },
  task: P('id', 'subject', 'articleId', 'entityReferences', 'assignees'),
  quotation: P('id', 'customerId', 'quotationNumber', 'quotationDate', 'validTo', 'status', 'netAmount', 'grossAmount', 'commission', 'recordComment', 'quotationItems'),
  quotationItem: P('articleId', 'quantity', 'unitPrice', 'manualUnitPrice', 'positionNumber', 'title', 'description', 'discountPercentage'),
  salesOrder: P('orderNumber', 'orderDate', 'customerId', 'netAmount', 'status', 'quotationId', 'invoiced'),
  salesInvoice: P('invoiceNumber', 'customerId', 'invoiceDate', 'dueDate', 'grossAmount', 'netAmount', 'paid', 'paymentStatus', 'status'),
  party: P('company', 'customer', 'customerNumber', 'partyType', 'email', 'phone', 'addresses', 'firstName', 'lastName'),
  contract: P('partyId', 'contractStatus', 'contractItems', 'contractNumber'),
  contractItem: P('interval', 'intervalType', 'netAmount', 'unitPrice', 'quantity', 'articleId'),
  ticket: P('ticketNumber', 'subject', 'partyId', 'contactId', 'ticketStatusId', 'assignedUserId', 'ticketPriorityId', 'ticketTypeId', 'solution', 'lastModifiedDate'),
  comment: P('id', 'entityName', 'entityId', 'comment', 'publicComment'),
  article: P('articleNumber', 'name', 'articlePrices', 'active'),
  offerStatusType: { enum: ['OPEN', 'ENTRY_COMPLETED', 'INQUIRED', 'ACCEPTED', 'REJECTED', 'CANCELLED'] },
  orderStatusType: { enum: ['ORDER_ENTRY_IN_PROGRESS', 'ORDER_CONFIRMATION_PRINTED', 'CLOSED', 'MANUALLY_CLOSED', 'CANCELLED'] },
  salesInvoiceStatusType: { enum: ['NEW', 'ENTRY_COMPLETED', 'DOCUMENT_CREATED', 'OPEN_ITEM_CREATED', 'CANCELLED'] },
  paymentStatus: { enum: ['OPEN', 'PAID', 'NO_OPEN_ITEM', 'CLEARED_WITH_CREDIT_NOTE', 'CREDIT_NOTE_CLEARED', 'UNKNOWN'] },
  quotationType: { enum: ['SALES_ORDER', 'BLANKET_SALES_ORDER', 'CONTRACT', 'NONE', 'PROJECT', 'SALES_INVOICE'] },
  billingInterval: { enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTER', 'HALF_YEARLY', 'YEARLY'] },
} } }));
r.get('/user', (req, res) => res.json({ result: applyFilters(Object.values(users), req.query) }));
r.post('/timeRecord', (req, res) => {
  const b = req.body;
  if ('billable' in b) return res.status(400).json({ title: 'Validation failed', validationErrors: [{ location: 'billable', message: 'property billable is read-only' }] });
  const unknown = Object.keys(b).filter((k) => !TR_FIELDS.includes(k));
  if (unknown.length) return res.status(400).json({ title: 'Bad Request', detail: `unknown property ${unknown.join(', ')}` });
  for (const f of ['userId', 'taskId', 'startDate', 'durationSeconds']) {
    if (b[f] == null) return res.status(400).json({ title: 'Bad Request', detail: `${f} fehlt` });
  }
  const task = tasks.find((x) => x.id === b.taskId);
  if (task?.assignees && !task.assignees.some((a) => a.userId === String(b.userId))) {
    return res.status(400).json({ title: 'validation failed', messages: [{ message: `The assignee of the time record booked on task "${task.subject}" is not an assignee of this task. Select an assignee of this task.` }] });
  }
  if (task && task.articleId === '703') {
    return res.status(400).json({ title: 'validation failed', status: 400, messages: [{ severity: 'ERROR', location: 'taskId', message: 'article is not effort based (Test)' }] });
  }
  if (task && !task.articleId && !task.orderItemId && (b.billableDurationSeconds ?? 0) > 0) {
    return res.status(400).json({ title: 'Validation failed', detail: 'time record without effort based article or orderItem cannot have a billable duration greater than 0.' });
  }
  const rec = { id: String(80000 + timeRecords.length), ...b, billable: (b.billableDurationSeconds ?? 1) > 0, createdDate: Date.now() };
  timeRecords.push(rec);
  console.log('[mock] timeRecord angelegt:', JSON.stringify(rec));
  res.status(201).json(rec);
});

export function weclappMock() {
  registerSales(r, { applyFilters, parties, tickets, timeRecords, tasks, documents, articles, statuses, users });
  const app = express.Router();
  app.use(express.json({ limit: '2mb' }));
  app.use('/webapp/api/v2', r);
  return app;
}
