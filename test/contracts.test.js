// Verträge mit eigenem Lese-Token: Benutzer ohne Vertragslizenz sieht trotzdem den Managed-Service-Umsatz
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3395';
process.env.WECLAPP_CONTRACTS_TOKEN = 'demo-max'; // lizenzierter Benutzer (Mock)
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-contracts-'));
const { weclappMock } = await import('../server/mock/weclapp.js');
const contracts = await import('../server/contracts.js');
const sales = await import('../server/sales.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/weclapp', weclappMock());
  await new Promise((r) => { server = app.listen(3395, r); });
});
after(() => server.close());

test('Verträge werden mit dem Vertrags-Token gelesen, nicht mit dem Benutzer-Token', async () => {
  const rows = await contracts.activeContracts('benutzer-ohne-lizenz');
  assert.ok(rows.length > 0);
  assert.equal(contracts.usesServiceToken(), true);
});

test('Kundenansicht: nur Summen, auch für Benutzer ohne Vertragslizenz', async () => {
  const f = await sales.customerFacts('benutzer-ohne-lizenz', '501');
  assert.deepEqual(Object.keys(f.contracts).sort(), ['count', 'monthly']); // keine Vertragsdetails
  assert.equal(f.contracts.count, 1);
  assert.equal(f.contracts.monthly, 3 * 29 + 99);
});
