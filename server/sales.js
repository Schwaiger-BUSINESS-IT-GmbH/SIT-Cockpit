// weclapp-Vertriebsdaten für Dashboard, Kundenansicht und Angebotsboard.
// Alle Aufrufe laufen mit dem persönlichen Token -> es gelten die weclapp-Rechte
// des Users. Jeder Dashboard-Bereich lädt für sich; fehlt ein Recht, bleibt nur
// dieser Bereich leer statt das ganze Dashboard.
import { config } from './config.js';
import { request, unwrap } from './weclapp.js';
import { activeContracts, contractsOfParty } from './contracts.js';

const get = (token, path, query) => request(token, 'GET', path, { query }).then(unwrap);
const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const sum = (rows, f) => rows.reduce((s, r) => s + n(typeof f === 'function' ? f(r) : r[f]), 0);
const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).getTime();

export const OPEN_QUOTATION = ['OPEN', 'ENTRY_COMPLETED', 'INQUIRED'];
const OPEN_ORDER = ['ORDER_ENTRY_IN_PROGRESS', 'ORDER_CONFIRMATION_PRINTED'];
const INTERVAL_PER_MONTH = { DAILY: 30, WEEKLY: 52 / 12, MONTHLY: 1, QUARTER: 1 / 3, HALF_YEARLY: 1 / 6, YEARLY: 1 / 12, TWO_YEARLY: 1 / 24, THREE_YEARLY: 1 / 36, FOUR_YEARLY: 1 / 48, FIVE_YEARLY: 1 / 60 };

const partyName = (p) => p.company || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.customerNumber || `Kunde ${p.id}`;

async function partyNames(token, ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const out = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const rows = await get(token, '/party', {
      'id-in': JSON.stringify(uniq.slice(i, i + 100)), properties: 'id,company,firstName,lastName,customerNumber', pageSize: 100,
    }).catch(() => []);
    for (const p of rows) out[p.id] = partyName(p);
  }
  return out;
}

// Status-IDs der geschlossenen Tickets (über den Namen, wie in SIT-Time)
let closedStatus = { at: 0, ids: [] };
async function closedTicketStatusIds(token) {
  if (Date.now() - closedStatus.at < 600e3) return closedStatus.ids;
  const rows = await get(token, '/ticketStatus', { pageSize: 200 }).catch(() => []);
  const re = config.hiddenStatusPattern ? new RegExp(config.hiddenStatusPattern, 'i') : null;
  const ids = rows.filter((s) => config.hiddenTicketStatusIds.includes(String(s.id)) || (re && re.test(s.name || ''))).map((s) => String(s.id));
  closedStatus = { at: Date.now(), ids };
  return ids;
}

// Abschnitt laden, Fehler einfangen (z. B. fehlende Rechte)
const section = (p) => p.catch((e) => ({ error: e.status === 403 ? 'Keine Berechtigung in weclapp' : e.message }));

// ---------- Kunden ----------
export async function findParty(token, { number, name }) {
  const props = 'id,company,firstName,lastName,customerNumber';
  if (number) {
    const [p] = await get(token, '/party', { 'customerNumber-eq': number, properties: props, pageSize: 1 });
    if (p) return { id: p.id, name: partyName(p), number: p.customerNumber, matchedBy: 'number' };
  }
  if (name) {
    const rows = await get(token, '/party', { 'company-ilike': name.trim(), properties: props, pageSize: 2 });
    if (rows.length === 1) return { id: rows[0].id, name: partyName(rows[0]), number: rows[0].customerNumber, matchedBy: 'name' };
  }
  return null;
}

export async function searchCustomers(token, q) {
  const term = String(q || '').trim();
  const base = { properties: 'id,company,firstName,lastName,customerNumber', pageSize: 20, 'customer-eq': true, sort: 'company' };
  if (!term) return (await get(token, '/party', base)).map((p) => ({ id: p.id, name: partyName(p), number: p.customerNumber }));
  const [byName, byNumber, byLast] = await Promise.all([
    get(token, '/party', { ...base, 'company-ilike': `%${term}%` }).catch(() => []),
    get(token, '/party', { ...base, 'customerNumber-ilike': `%${term}%` }).catch(() => []),
    get(token, '/party', { ...base, 'lastName-ilike': `%${term}%` }).catch(() => []),
  ]);
  const seen = new Set();
  return [...byNumber, ...byName, ...byLast]
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
    .slice(0, 20)
    .map((p) => ({ id: p.id, name: partyName(p), number: p.customerNumber }));
}

export async function customerContact(token, id) {
  const p = unwrap(await request(token, 'GET', `/party/id/${encodeURIComponent(id)}`));
  const a = (p.addresses || []).find((x) => x.primeAddress || x.invoiceAddress) || (p.addresses || [])[0] || {};
  return {
    id: p.id,
    name: partyName(p),
    number: p.customerNumber || '',
    email: p.email || p.invoiceEmail || '',
    phone: p.phone || '',
    contact: p.contactName || '',
    address: [a.street1, [a.zipcode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
}

/** Kennzahlen eines Kunden für die Kundenansicht */
export async function customerFacts(token, partyId) {
  const closed = await closedTicketStatusIds(token);
  const [tickets, quotations, contracts] = await Promise.all([
    section(get(token, '/ticket', {
      'partyId-eq': partyId, properties: 'id,ticketNumber,subject,ticketStatusId,assignedUserId,lastModifiedDate', sort: '-lastModifiedDate', pageSize: 100,
      ...(closed.length ? { 'ticketStatusId-notin': JSON.stringify(closed) } : {}),
    }).then((rows) => ({ count: rows.length, items: rows.slice(0, 8).map((t) => ({ id: t.id, number: t.ticketNumber, subject: t.subject, modified: t.lastModifiedDate })) }))),
    section(get(token, '/quotation', {
      'customerId-eq': partyId, 'status-in': JSON.stringify(OPEN_QUOTATION), properties: 'id,quotationNumber,quotationDate,netAmount,status', sort: '-quotationDate', pageSize: 50,
    }).then((rows) => ({ count: rows.length, net: sum(rows, 'netAmount'), items: rows.slice(0, 5).map((q) => ({ id: q.id, number: q.quotationNumber, date: q.quotationDate, net: n(q.netAmount) })) }))),
    section(contractsOfParty(token, partyId)
      .then((rows) => ({ count: rows.length, monthly: monthlyValue(rows) }))),
  ]);
  return { tickets, quotations, contracts };
}

export function monthlyValue(contracts) {
  let total = 0;
  for (const c of contracts) {
    for (const it of c.contractItems || []) {
      if (it.intervalType && it.intervalType !== 'RECURRENT') continue;
      const f = INTERVAL_PER_MONTH[it.interval] ?? 0;
      const net = it.netAmount != null ? n(it.netAmount) : n(it.unitPrice) * n(it.quantity || 1);
      total += net * f;
    }
  }
  return Math.round(total * 100) / 100;
}

// ---------- Dashboard ----------
export async function dashboard(token, { userId }) {
  const now = Date.now();
  const mStart = monthStart();
  const sixMonthsAgo = monthStart(new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1));
  const closed = await closedTicketStatusIds(token);

  const [quotations, accepted, orders, intake, tickets, contracts, myTime] = await Promise.all([
    section(get(token, '/quotation', {
      'status-in': JSON.stringify(OPEN_QUOTATION),
      properties: 'id,quotationNumber,customerId,quotationDate,validTo,netAmount,status,responsibleUserId',
      sort: 'quotationDate', pageSize: 1000,
    })),
    section(get(token, '/quotation', {
      'status-eq': 'ACCEPTED', 'lastModifiedDate-ge': mStart, properties: 'id,netAmount', pageSize: 1000,
    })),
    section(get(token, '/salesOrder', {
      'status-in': JSON.stringify(OPEN_ORDER), properties: 'id,orderNumber,customerId,orderDate,netAmount,status,invoiced', pageSize: 1000,
    })),
    section(get(token, '/salesOrder', {
      'orderDate-ge': sixMonthsAgo, properties: 'id,orderDate,netAmount,status', pageSize: 1000,
    })),
    section(request(token, 'GET', '/ticket/count', {
      query: closed.length ? { 'ticketStatusId-notin': JSON.stringify(closed) } : {},
    }).then((d) => ({ open: Number(unwrap(d)) || 0 }))),
    section(activeContracts(token)),
    section(get(token, '/timeRecord', {
      'userId-eq': userId, 'startDate-ge': mStart, properties: 'id,durationSeconds,billableDurationSeconds,billable', pageSize: 1000,
    })),
  ]);

  const out = { generatedAt: now, followUpDays: config.quotationFollowUpDays };
  const names = await partyNames(token, [
    ...(Array.isArray(quotations) ? quotations.map((q) => q.customerId) : []),
  ]);

  if (Array.isArray(quotations)) {
    const followUp = quotations.filter((q) => n(q.quotationDate) && now - q.quotationDate > config.quotationFollowUpDays * 864e5);
    out.quotations = {
      count: quotations.length,
      net: sum(quotations, 'netAmount'),
      followUpCount: followUp.length,
      followUpNet: sum(followUp, 'netAmount'),
      list: quotations
        .map((q) => ({
          id: q.id, number: q.quotationNumber, customer: names[q.customerId] || '', date: n(q.quotationDate), validTo: n(q.validTo) || null,
          net: n(q.netAmount), ageDays: Math.floor((now - n(q.quotationDate)) / 864e5), status: q.status,
        }))
        .sort((a, b) => b.ageDays - a.ageDays)
        .slice(0, 25),
    };
  } else out.quotations = quotations;

  out.accepted = Array.isArray(accepted) ? { count: accepted.length, net: sum(accepted, 'netAmount') } : accepted;
  out.orders = Array.isArray(orders) ? { count: orders.length, net: sum(orders, 'netAmount') } : orders;

  if (Array.isArray(intake)) {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('de-AT', { month: 'short' }), year: d.getFullYear(), net: 0 });
    }
    for (const o of intake) {
      if (o.status === 'CANCELLED') continue;
      const d = new Date(n(o.orderDate));
      const m = months.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (m) m.net += n(o.netAmount);
    }
    out.intake = months.map(({ key, ...m }) => ({ ...m, net: Math.round(m.net) }));
  } else out.intake = intake;

  // Rechnungen gehören ins Finanz-Dashboard (nur Entra-Gruppe), nicht in den Vertrieb
  out.tickets = tickets;
  out.contracts = Array.isArray(contracts) ? { count: contracts.length, monthly: monthlyValue(contracts) } : contracts;
  out.myTime = Array.isArray(myTime)
    ? { minutes: Math.round(sum(myTime, 'durationSeconds') / 60), billableMinutes: Math.round(sum(myTime, (r) => r.billableDurationSeconds ?? (r.billable ? r.durationSeconds : 0)) / 60) }
    : myTime;
  return out;
}
