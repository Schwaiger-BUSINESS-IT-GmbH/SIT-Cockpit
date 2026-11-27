// Backup-Übersicht: Veeam-Ereignisse aus Atera lesen, Sicherungsnacht, Wochentabelle je Kunde
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3392';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-backup-'));
const { ateraMock } = await import('../server/mock/atera.js');
const bk = await import('../server/backups.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/atera/api/v3', ateraMock());
  await new Promise((r) => { server = app.listen(3392, r); });
});
after(() => server.close());

test('Veeam-Ereignis wie in Atera: Ereignis-ID, Job, Ergebnis, Maschine, Beschreibung', () => {
  const e = bk.parseEvent({
    AlertID: 30436, Severity: 'Warning', Title: 'Ereignisprotokoll: Veeam Backup | Ereignis-ID: 190', Created: '2026-11-26T23:35:39Z',
    AlertMessage: "Retry of Backup job 'Backup Job NAS' finished with Failed.\r\nJob details: Error: Failed to call RPC function 'FcCreateDir'.\n[Maschinenname: Backup-SRV]",
    CustomerID: 7, CustomerName: 'Muster', DeviceName: 'BACKUP-SRV', Archived: false,
  });
  assert.equal(e.eventId, '190');
  assert.equal(e.source, 'Veeam Backup');
  assert.equal(e.job, 'Backup Job NAS');
  assert.equal(e.result, 'failed');
  assert.equal(e.retry, true);
  assert.equal(e.device, 'Backup-SRV');
  assert.match(e.text, /Job details: Error/);
  assert.ok(!/Maschinenname/.test(e.text));
  assert.equal(bk.parseEvent({ Title: 'Ereignisprotokoll: Veeam Backup | Ereignis-ID: 190', AlertMessage: "Backup job 'X' finished with Success.", Severity: 'Information' }).result, 'success');
  assert.equal(bk.parseEvent({ Title: 'Backup-Job "Nacht" fehlgeschlagen (Veeam)', Severity: 'Critical' }).result, 'failed');
});

test('Sicherungsnacht: 00:35 Uhr zählt zum Vortag, Woche beginnt Montag', () => {
  assert.equal(bk.dayKey(Date.parse('2026-11-26T23:35:39Z'), 12), '2026-11-26'); // 00:35 Wien am 27.
  assert.equal(bk.dayKey(Date.parse('2026-11-27T13:00:00Z'), 12), '2026-11-27');
  const w = bk.weekDays(0, Date.parse('2026-11-27T10:00:00Z'));
  assert.deepEqual([w[0], w[6]], ['2026-11-23', '2026-11-29']);
  assert.equal(bk.weekDays(-1, Date.parse('2026-11-27T10:00:00Z'))[0], '2026-11-16');
  // letzte abgeschlossene Nacht: Freitag vormittags und nachmittags die Nacht Do->Fr
  assert.equal(bk.lastNight(Date.parse('2026-11-27T09:00:00Z'), 12), '2026-11-26');
  assert.equal(bk.lastNight(Date.parse('2026-11-27T15:00:00Z'), 12), '2026-11-26');
  assert.equal(bk.lastNight(Date.parse('2026-11-27T23:30:00Z'), 12), '2026-11-27');
});

test('Tagesstatus: erfolgreicher Retry hebt Fehler auf, sonst zählt der schlimmste Job', () => {
  const ev = (at, result, job = 'J') => ({ at, result, job, device: 'S', title: 't' });
  assert.equal(bk.dayStatus([ev(1, 'failed'), ev(2, 'success')]), 'success');
  assert.equal(bk.dayStatus([ev(1, 'success'), ev(2, 'failed')]), 'failed');
  assert.equal(bk.dayStatus([ev(1, 'success', 'A'), ev(2, 'warning', 'B')]), 'warning');
  assert.equal(bk.dayStatus([]), null);
});

test('Wochentabelle aus dem Atera-Mock', async () => {
  const r = await bk.backupReport({ week: -1, force: true });
  assert.equal(r.error, null);
  assert.equal(r.days.length, 7);
  const c = (name) => r.customers.find((x) => x.name.startsWith(name));
  // Wimmer: jede Nacht fehlgeschlagen -> ganz oben, 7 rote X
  assert.equal(r.customers[0].name, 'Ordination Dr. Wimmer');
  assert.equal(c('Ordination').failed, 7);
  const cell = c('Ordination').cells[0];
  assert.equal(cell.events.length, 2);
  assert.equal(cell.events[0].eventId, '190');
  // Lang meldet Erfolge: grüne Haken, Retry-Erfolg zählt als Erfolg
  assert.equal(c('Steuerberatung').reportsSuccess, true);
  assert.ok(c('Steuerberatung').successes >= 5);
  // Kunde ohne Backup-Meldungen: "kein Fehler gemeldet"
  assert.ok(c('Kanzlei').cells.every((x) => x.status === 'quiet'));
  assert.equal(r.successSeen, true);
  // aktuelle Woche nutzt den Speicher, Zukunft bleibt leer
  const cur = await bk.backupReport({ week: 0 });
  assert.ok(cur.days.some((d) => d.today));
  assert.ok(cur.customers.every((x) => x.cells.filter((_, i) => cur.days[i].future).every((y) => y.status === 'future')));
});
