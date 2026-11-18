// Ticket aus Atera-Problem: Vorbelegung, Duplikate, Anlegen in weclapp (Mock)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3397';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-tickets-'));
const { weclappMock } = await import('../server/mock/weclapp.js');
const tk = await import('../server/tickets.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/weclapp', weclappMock());
  await new Promise((r) => { server = app.listen(3397, r); });
});
after(() => server.close());
const session = { userId: '101', name: 'Rene Schwaiger' };

test('Vorbelegung: offener Status, Kanal Monitoring, Priorität nach Ampel, Bearbeiter ich', async () => {
  const m = await tk.ticketMeta('demo-rene', '101');
  assert.equal(m.statuses.find((s) => s.id === m.defaults.statusId).name, 'Offen');
  assert.ok(!m.statuses.some((s) => s.name === 'Geschlossen'));
  assert.equal(m.channels.find((c) => c.id === m.defaults.channelId).name, 'Monitoring');
  assert.equal(m.priorities.find((p) => p.id === m.defaults.priorityCritical).name, 'Kritisch');
  assert.equal(m.priorities.find((p) => p.id === m.defaults.priorityWarning).name, 'Normal');
  assert.equal(m.defaults.assignedUserId, '101');
});

test('Anlegen: Pflichtfelder gesetzt, Kunden-Mail standardmäßig aus, Problem wird verknüpft', async () => {
  const t = await tk.createTicket('demo-rene', {
    partyId: '503', subject: 'MAIER-SRV01: Server offline seit 47 Min.', description: 'Test',
    source: { customerId: 3, deviceGuid: 'dev-1012', kind: 'offline' },
  }, session);
  assert.match(t.number, /^T-/);
  const links = tk.ticketLinks(3);
  assert.equal(links[tk.problemKey('dev-1012', { kind: 'offline' })].number, t.number);
  const similar = await tk.similarTickets('demo-rene', '503', 'MAIER-SRV01');
  assert.ok(similar.some((s) => s.number === t.number));
});

test('Ohne weclapp-Kunde oder Betreff wird nichts angelegt', async () => {
  await assert.rejects(tk.createTicket('demo-rene', { subject: 'X-Problem' }, session), /Kein weclapp-Kunde/);
  await assert.rejects(tk.createTicket('demo-rene', { partyId: '503', subject: '' }, session), /Betreff/);
});

test('Kundenzuordnung: unscharfer Namensvergleich', async () => {
  const cm = await import('../server/customermap.js');
  const parties = [{ id: '1', name: 'Schwing-Stetter Austria GmbH' }, { id: '2', name: 'Bäckerei Weinberger KG' }, { id: '3', name: 'Bäckerei Huber' }, { id: '4', name: 'Hofer Elektrotechnik e.U.' }];
  assert.equal(cm.bestMatches('Bäckerei Weinberger', parties)[0].id, '2');
  assert.equal(cm.bestMatches('Schwing Stetter', parties)[0].id, '1');
  assert.equal(cm.bestMatches('Elektro Hofer e.U.', parties)[0].id, '4');
  assert.equal(cm.bestMatches('NOE', parties).length, 0);
  assert.equal(cm.normName('Muster GmbH & Co. KG'), 'muster');
});
