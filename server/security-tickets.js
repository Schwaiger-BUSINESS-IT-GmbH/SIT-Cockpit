// Tickets aus einer Security-Meldung: je betroffenem Kunden ein weclapp-Ticket.
// Der weclapp-Kunde kommt aus der Kundenzuordnung (Atera -> weclapp). Bereits angelegte
// Tickets werden je Meldung und Kunde gemerkt und nicht doppelt angelegt.
import * as security from './security.js';
import * as custmap from './customermap.js';
import * as tickets from './tickets.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

async function load(key) {
  if (!key || typeof key !== 'string' || key.length > 120) throw bad('Meldung fehlt');
  const it = await security.itemForTickets(key);
  if (!it) throw bad('Meldung nicht gefunden (älter als 365 Tage?)', 404);
  return it;
}

async function withParties(token, it) {
  const ateraById = new Map(it.ateraCustomers.map((c) => [String(c.id), c]));
  return mapLimit(it.customers, 5, async (c) => {
    const ac = ateraById.get(String(c.id)) || { id: c.id, name: c.name };
    const party = await custmap.resolveParty(token, ac).catch(() => null);
    return { ...c, party };
  });
}

/** Vorschau für den Dialog: betroffene Kunden mit weclapp-Kunde und schon angelegtem Ticket */
export async function prepare(token, key) {
  const it = await load(key);
  const customers = await withParties(token, it);
  return {
    key: it.key, title: it.title, vendor: it.vendor, productLabel: it.productLabel,
    customers: customers.map((c) => ({
      id: String(c.id), name: c.name, devices: c.deviceList.map((d) => d.name),
      party: c.party ? { id: c.party.id, name: c.party.name, number: c.party.number } : null,
      ticket: c.ticket,
    })),
  };
}

const deviceText = (c) => (c.deviceList.length
  ? `Betroffene Geräte bei ${c.name} (aus Atera):\n${c.deviceList.map((d) => `- ${d.name}${d.os ? ` (${d.os})` : ''}`).join('\n')}`
  : '');

/** Tickets für die gewählten Kunden anlegen */
export async function create(token, body, session) {
  const it = await load(body.key);
  const want = new Set((Array.isArray(body.customerIds) ? body.customerIds : []).map(String));
  if (!want.size) throw bad('Bitte mindestens einen Kunden auswählen');
  const chosen = it.customers.filter((c) => want.has(String(c.id)));
  const customers = await withParties(token, { ...it, customers: chosen });
  const results = [];
  for (const c of customers) {
    const base = { customerId: String(c.id), name: c.name };
    if (c.ticket) { results.push({ ...base, skipped: `Ticket ${c.ticket.number} besteht schon` }); continue; }
    if (!c.party) { results.push({ ...base, skipped: 'kein weclapp-Kunde zugeordnet' }); continue; }
    try {
      const t = await tickets.createTicket(token, {
        partyId: c.party.id,
        subject: body.subject,
        description: [String(body.description || '').trim(), deviceText(c)].filter(Boolean).join('\n\n'),
        priorityId: body.priorityId, statusId: body.statusId, channelId: body.channelId,
        assignedUserId: body.assignedUserId, notifyCustomer: Boolean(body.notifyCustomer),
      }, session);
      security.recordTicket(it.key, c.id, t, session.name);
      results.push({ ...base, ticket: { id: t.id, number: t.number } });
    } catch (e) {
      results.push({ ...base, error: e.message });
    }
  }
  // Meldung ist damit in Bearbeitung
  if (results.some((r) => r.ticket) && it.status?.status === 'new') {
    security.setStatus(it.key, { status: 'progress', note: it.status.note || `Tickets für ${results.filter((r) => r.ticket).length} Kunden angelegt` }, session.name);
  }
  return { results, created: results.filter((r) => r.ticket).length };
}
