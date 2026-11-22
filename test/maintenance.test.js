// Wartungsverträge: Rechenregeln und Auswertung gegen den weclapp-Mock
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3394';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-maint-'));
const { weclappMock } = await import('../server/mock/weclapp.js');
const { ateraMock } = await import('../server/mock/atera.js');
const m = await import('../server/maintenance.js');

const D = 864e5;
let server;
before(async () => {
  const app = express();
  app.use('/__mock/weclapp', weclappMock());
  app.use('/__mock/atera/api/v3', ateraMock());
  await new Promise((r) => { server = app.listen(3394, r); });
});
after(() => server.close());

test('Monatswert: Intervalle umrechnen, einmalige Positionen ignorieren', () => {
  assert.equal(m.itemMonthly({ netAmount: '120', interval: 'YEARLY', intervalType: 'RECURRENT' }), 10);
  assert.equal(m.itemMonthly({ unitPrice: '30', quantity: '3', interval: 'QUARTER' }), 30);
  assert.equal(m.itemMonthly({ netAmount: '500', interval: 'NONE', intervalType: 'NON_RECURRENT' }), 0);
});

test('Laufzeit im Zeitraum: späterer Beginn und Vertragsende werden berücksichtigt', () => {
  const to = Date.UTC(2026, 11, 31), from = to - 365.25 * D;
  assert.ok(Math.abs(m.activeMonths({ startDate: from - 100 * D, unlimited: true }, from, to) - 12) < 0.01);
  assert.ok(Math.abs(m.activeMonths({ startDate: to - 91.3 * D, unlimited: true }, from, to) - 3) < 0.05);
  assert.ok(Math.abs(m.activeMonths({ startDate: from, endDate: from + 182.6 * D }, from, to) - 6) < 0.05);
  assert.equal(m.activeMonths({ startDate: to + D, unlimited: true }, from, to), 0);
});

test('Einkaufspreis: nur heute gültige Preise, kleinste Staffel', () => {
  const now = Date.now();
  assert.equal(m.currentPrice([
    { price: '9', priceScaleValue: '10', startDate: now - D },
    { price: '11', priceScaleValue: '1', startDate: now - D },
    { price: '5', priceScaleValue: '1', startDate: now - 9 * D, endDate: now - 2 * D },
  ], now), 11);
  assert.equal(m.currentPrice([], now), null);
});

test('Auswertung: Kostenpositionen vor Einkaufspreis, Stunden ab Vertragsbeginn, Kunden ohne Vertrag', async () => {
  const r = await m.maintenanceReport('demo-max', { months: 12, rate: 60 });
  const lang = r.customers.find((c) => c.partyId === '502');
  assert.equal(lang.contracts[0].costSource, 'vertrag');
  assert.equal(lang.monthlyCost, 8 * 12 + 2 * 98);
  const huber = r.customers.find((c) => c.partyId === '501');
  assert.equal(huber.contracts[0].costSource, 'einkauf');
  assert.equal(huber.monthlyCost, 3 * 11); // 800 = 11 € Einkauf, 804 ist Dienstleistung
  // Wagner: Vertrag seit ~150 Tagen -> nur Stunden ab dann
  const wagner = r.customers.find((c) => c.partyId === '507');
  assert.ok(wagner.since);
  assert.ok(wagner.hoursTotal < 2 * 1.3 * 6);
  // Marge = Ertrag − Lizenzen − Stunden × Satz
  for (const c of r.customers) assert.ok(Math.abs(c.margin - (c.revenue - c.licenseCost - c.hoursCounted * 60)) < 0.5); // Stunden auf 0,01 h gerundet
  const without = r.without.rows.map((x) => x.partyId);
  assert.ok(without.includes('506') && without.includes('503'));
  assert.ok(!without.includes('501'));
});

test('Filter Vertragstyp und Stundensatz', async () => {
  const r = await m.maintenanceReport('demo-max', { type: 't1', rate: 100, hours: 'all' });
  assert.equal(r.selectedType, 't1');
  assert.equal(r.rate, 100);
  assert.ok(r.customers.length && r.customers.length < 6);
  for (const c of r.customers) assert.equal(c.hoursCounted, c.hoursTotal);
  // Kunden mit Vertrag eines anderen Typs erscheinen unter "ohne", markiert
  assert.ok(r.without.rows.some((x) => x.otherContract));
});
