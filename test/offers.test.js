// Angebotsboard (V4-Modell): Berechnung am Server, Prüfpunkte, Unterschrift -> weclapp (Mock)
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

const sel = (id, qty, extra = {}) => ({ id, selected: true, qty, ...extra });
const SIG = 'data:image/png;base64,' + Buffer.alloc(3000, 7).toString('base64');

test('Staffelpreis ab Schwelle, nicht ausgewählte Produkte zählen nicht', () => {
  const r = offers.calculate({ products: [sel('secultimate', 29), { id: 'fwessential', selected: false, qty: 2 }], assets: { firewalls: 1 } });
  assert.equal(r.monthly.length, 1);
  assert.equal(r.monthly[0].price, 25);
  const r2 = offers.calculate({ products: [sel('secultimate', 30)] });
  assert.equal(r2.monthly[0].price, 23);
  assert.equal(r2.totals.monthly, 690);
  assert.equal(r2.totals.arr, 8280);
});

test('SLA: Grundgebühr, Benutzer, Zusatzstandorte, Review, Einrichtung', () => {
  const r = offers.calculate({ sla: 'priority', review: 'quarter', setup: true, assets: { users: 10, sites: 3 } });
  const skus = r.monthly.map((l) => `${l.sku}:${l.qty}x${l.price}`);
  assert.deepEqual(skus, ['SIT-SLA-PRI-G:1x199', 'SIT-SLA-PRI-U:10x7', 'SIT-SLA-SITE:2x59', 'SIT-GOV-QBR:1x179']);
  assert.equal(r.once[0].sku, 'SIT-SLA-SETUP');
  assert.equal(r.totals.monthly, 199 + 70 + 118 + 179);
  assert.equal(r.totals.once, 290);
  assert.ok(r.warnings.some((w) => /Entwurfswerte/.test(w)));
});

test('Preise vom Browser werden ignoriert, Projekt wird übernommen', () => {
  const r = offers.calculate({ products: [sel('serverremote', 2, { price: 1 })], project: { enabled: true, name: 'M365-Migration', price: 1200 } });
  assert.equal(r.monthly[0].price, 49.9);
  assert.equal(r.once[0].name, 'M365-Migration');
  assert.equal(r.totals.first, 99.8 + 1200);
});

test('Prüfpunkte blockieren die Unterschrift ohne interne Freigabe', async () => {
  const input = { customer: { id: '501', company: 'Bäckerei Huber GmbH' }, products: [sel('secprofessional', 5)], signerName: 'Max Muster', acceptedTerms: true, signature: SIG };
  await assert.rejects(offers.signAndCreate('demo-rene', input, { userId: '101', name: 'Test' }), /Prüfpunkte/);
});

test('Artikelzuordnung: Vorschläge über den Namen, Preisabweichung erkannt', async () => {
  const sug = await offers.suggestArticles('demo-rene');
  assert.equal(sug['SIT-MCLI-PRE']?.number, '10020');
  assert.equal(sug['SIT-MFW-ESS']?.number, '10030');
  assert.equal(sug['SIT-SLA-STD-G'], undefined); // SLA-Pakete gibt es (noch) nicht
  await offers.setArticleMapping('demo-rene', 'SIT-MFW-PRE', sug['SIT-MFW-PRE'].id, { name: 'Test' });
  const list = await offers.articleMapping('demo-rene');
  const fw = list.find((p) => p.sku === 'SIT-MFW-PRE');
  assert.equal(fw.status, 'mapped');
  assert.equal(fw.deviation, 10); // weclapp 459 € statt 449 €
});

test('Ohne Zuordnung bleibt der Vorgang gespeichert und meldet die Position', async () => {
  const r = await offers.signAndCreate('demo-rene', {
    customer: { id: '501', company: 'Bäckerei Huber GmbH' }, products: [sel('serverremote', 1)],
    ready: true, signerName: 'Max Muster', acceptedTerms: true, signature: SIG,
  }, { userId: '101', name: 'Test' });
  assert.equal(r.status, 'weclapp-failed');
  assert.match(r.warningsWeclapp.join(' '), /SIT-SUP-SRV/);
});

test('Neukunde + Unterschrift -> Kunde, Angebot, Auftrag in weclapp (mit zugeordneten Artikeln)', async () => {
  const sug = await offers.suggestArticles('demo-rene');
  for (const sku of ['SIT-MCLI-PRE', 'SIT-MFW-ESS']) await offers.setArticleMapping('demo-rene', sku, sug[sku].id, { name: 'Test' });
  const r = await offers.signAndCreate('demo-rene', {
    customer: { company: 'Neu GmbH', contact: 'Anna Neu', mail: 'office@neu.example' },
    assets: { users: 5, clients: 5, servers: 1, firewalls: 1, sites: 1 },
    products: [sel('clientpremium', 5), sel('fwessential', 1)],
    internal: { category: 'Gold' },
    ready: true, signerName: 'Anna Neu', acceptedTerms: true, signature: SIG,
  }, { userId: '101', name: 'Test' });
  assert.equal(r.weclapp.partyCreated, true);
  assert.ok(r.weclapp.quotationNumber);
  assert.ok(r.weclapp.salesOrderNumber);
  assert.equal(r.status, 'done');
  assert.equal(r.signature, undefined); // Unterschrift nie an den Browser zurück
  assert.equal(r.totals.monthly, 5 * 18 + 149);
  assert.deepEqual(r.monthly.map((l) => l.articleNumber), ['10020', '10030']); // echte Nummern fürs PDF
});

test('Paket ohne weclapp-Artikel wird Prüfpunkt und verlangt die interne Freigabe', async () => {
  const input = { customer: { id: '501', company: 'Bäckerei Huber GmbH' }, products: [sel('secnode', 3)], signerName: 'Max Muster', acceptedTerms: true, signature: SIG };
  const r = await offers.calculateChecked('demo-rene', input);
  assert.ok(r.warnings.some((w) => /Noch kein weclapp-Artikel für: SIT Next Security Client Node Edition/.test(w)));
  await assert.rejects(offers.signAndCreate('demo-rene', input, { userId: '101', name: 'Test' }), /Prüfpunkte/);
  // zugeordnete Pakete erzeugen keinen solchen Prüfpunkt
  const ok = await offers.calculateChecked('demo-rene', { products: [sel('clientpremium', 2)] });
  assert.ok(!ok.warnings.some((w) => /weclapp-Artikel/.test(w)));
});

test('Englisch: gleiche Preise, englische Texte in Positionen und Katalog', async () => {
  const input = { sla: 'standard', assets: { users: 3, sites: 2 }, products: [sel('fwessential', 1)], project: { enabled: true, name: 'Migration', price: 100 } };
  const de = offers.calculate({ ...input, lang: 'de' });
  const en = offers.calculate({ ...input, lang: 'en' });
  assert.deepEqual(en.totals, de.totals);
  assert.equal(en.lang, 'en');
  assert.equal(en.monthly[0].name, 'Service level Standard – base fee');
  assert.match(en.monthly[0].desc, /P1 4 hours/);
  assert.equal(en.monthly.find((l) => l.sku === 'SIT-MFW-ESS').unit, 'FortiGate');
  assert.match(en.monthly.find((l) => l.sku === 'SIT-MFW-ESS').desc, /Scope limitations \/ prerequisites/);
  assert.equal(en.once.find((l) => l.project).unit, 'one-time');
  const cat = await offers.catalog('demo-rene', 'en');
  assert.equal(cat.lang, 'en');
  assert.equal(cat.groupLabels['Support-Flatrates'], 'Support Flat Rates');
  assert.equal(cat.products.find((p) => p.id === 'clientremote').name, 'SIT Client Flat Rate – Remote Support');
  const pdf = await offers.previewPdf({ ...input, lang: 'en' }, { name: 'Test' });
  assert.ok(pdf.length > 3000);
});
