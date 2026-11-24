// SIT-Time-Modul: Buchungsverhalten für weclapp v2 bleibt stabil (Aufgabe statt ticketId/articleId)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3398';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-time-'));
const { weclappMock } = await import('../server/mock/weclapp.js');
const wc = await import('../server/weclapp.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/weclapp', weclappMock());
  await new Promise((r) => { server = app.listen(3398, r); });
});
after(() => server.close());

test('v2: keine Pflichtaufgabe, kein ticketId/articleId – unabhängig vom Schema', async () => {
  assert.deepEqual(await wc.timeRecordNeedsTask('demo-rene'), { taskId: false, ticketId: false, articleId: false });
});

test('Buchung auf eine Aufgabe geht durch und erscheint unter „bereits gebucht“', async () => {
  const rec = await wc.createTimeRecord('demo-rene', {
    userId: '101', taskId: '6001', ticketId: '9000', articleId: '701',
    description: 'Test', startDate: Date.now() - 3600e3, durationSeconds: 900, billable: true,
  });
  assert.ok(rec.id);
  assert.equal(rec.ticketId, undefined); // ticketId wird bei Aufgabe nicht mitgeschickt
  const booked = await wc.ticketBookedTimes('demo-rene', '9000', '101');
  const json = JSON.stringify(booked);
  assert.ok(json.includes('Test'), 'neue Buchung fehlt in „bereits gebucht“');
});

test('v0.8.0: Ticket anlegen, Aufgabe anlegen, Ticket schließen', async () => {
  const opts = await wc.ticketFormOptions('demo-rene');
  assert.ok(opts.priorities.length && opts.types.length);
  const { ticket } = await wc.createTicket('demo-rene', { partyId: '501', subject: 'Neues Ticket aus SIT-Time', assignedUserId: '101', priorityId: 'p2', typeId: 'tt1' });
  assert.ok(ticket.id && ticket.number);
  assert.equal(ticket.customer, 'Bäckerei Huber GmbH');
  const task = await wc.createTicketTask('demo-rene', { ticketId: ticket.id, subject: ticket.subject, articleId: '701', userId: '101' });
  assert.ok(task.id);
  const r = await wc.closeTicket('demo-rene', ticket.id, 'Erledigt per Fernwartung');
  assert.equal(r.statusId, '3'); // „Geschlossen“
  const customers = await wc.searchCustomers('demo-rene', 'Huber');
  assert.ok(customers.some((c) => c.id === '501'));
});

test('v0.9.x: Ticket-Kommentare intern/extern lesen und schreiben, Ansprechpartner', async () => {
  const before = await wc.ticketComments('demo-rene', '9000', '101');
  assert.ok(before.some((c) => !c.external && c.author === 'Max Muster'));
  assert.ok(before.some((c) => c.external && /Papierstau/.test(c.text) && !/<b>/.test(c.text)));
  await wc.addComment('demo-rene', '9000', 'Kunde zurückgerufen', false);
  await wc.addComment('demo-rene', '9000', 'Wir melden uns morgen.', true);
  const after = await wc.ticketComments('demo-rene', '9000', '101');
  assert.equal(after.length, before.length + 2);
  const mine = after.filter((c) => c.mine);
  assert.deepEqual(mine.map((c) => c.external), [false, true]);
  const contacts = await wc.customerContacts('demo-rene', '501');
  assert.ok(Array.isArray(contacts));
});
