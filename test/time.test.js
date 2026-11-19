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
