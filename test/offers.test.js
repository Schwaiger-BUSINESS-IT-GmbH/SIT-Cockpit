// Angebotsboard: Preise werden am Server berechnet (Demo-Katalog über den Mock)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3399';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-'));
const { weclappMock } = await import('../server/mock/weclapp.js');
const offers = await import('../server/offers.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/weclapp', weclappMock());
  await new Promise((r) => { server = app.listen(3399, r); });
});
after(() => server.close());

test('Katalog kommt aus der Artikelkategorie und ist gruppiert', async () => {
  const cat = await offers.catalog('demo-rene', { fresh: true });
  assert.equal(cat.categoryFound, true);
  const all = cat.groups.flatMap((g) => g.items);
  assert.ok(all.find((i) => i.number === 'MS-WS' && i.price === 29 && i.billing === 'monthly'));
  assert.ok(all.find((i) => i.number === 'MS-ONBOARD' && i.billing === 'once'));
});

test('Berechnung ignoriert Preise vom Browser und begrenzt den Rabatt', async () => {
  const r = await offers.calculate('demo-rene', {
    items: [{ articleId: '800', quantity: 10, unitPrice: 1 }, { articleId: '809', quantity: 1 }, { articleId: 'gibtsnicht', quantity: 3 }],
    termMonths: 24, discountPercent: 99,
  });
  assert.equal(r.lines.length, 2);
  assert.equal(r.discount, 20); // maxDiscount
  assert.equal(r.totals.monthlyNet, 232); // 10 × 29 × 0,8
  assert.equal(r.totals.onceNet, 390); // einmalig ohne Rabatt
  assert.equal(r.termMonths, 24);
});

test('Ohne Unterschrift wird nichts angelegt', async () => {
  await assert.rejects(offers.signAndCreate('demo-rene', { customerId: '501', items: [{ articleId: '800', quantity: 1 }], signerName: 'Max Muster', acceptedTerms: true }, { userId: '101', name: 'Test' }), /unterschreiben/);
});
