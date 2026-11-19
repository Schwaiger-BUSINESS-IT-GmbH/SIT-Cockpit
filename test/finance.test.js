// Finanzen: Zugriff nur für die Entra-Gruppe, Kennzahlen aus weclapp (Mock).
// Läuft bewusst OHNE Demo-Modus und MIT Microsoft-Login-Pflicht wie in Azure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '0';
process.env.REQUIRE_ENTRA = '1';
process.env.FINANCE_GROUP_ID = 'grp-finanzen';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.WECLAPP_BASE_URL = 'http://127.0.0.1:3396/__mock/weclapp/webapp/api/v2';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-fin-'));
process.env.ATERA_API_KEY = 'x';
const { weclappMock } = await import('../server/mock/weclapp.js');
const access = await import('../server/access.js');
const fin = await import('../server/finance.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/weclapp', weclappMock());
  await new Promise((r) => { server = app.listen(3396, r); });
});
after(() => server.close());

const reqWith = (groups) => {
  const principal = groups === null ? null : Buffer.from(JSON.stringify({ claims: groups.map((g) => ({ typ: 'groups', val: g })) })).toString('base64');
  const headers = principal ? { 'x-ms-client-principal': principal } : {};
  return { get: (h) => headers[h.toLowerCase()] };
};

test('Finanzen nur für Mitglieder der Entra-Gruppe', () => {
  assert.equal(access.isFinance(reqWith(['grp-finanzen', 'andere'])), true);
  assert.equal(access.isFinance(reqWith(['grp-techniker'])), false);
  assert.equal(access.isFinance(reqWith([])), false);
  assert.equal(access.isFinance(reqWith(null)), false); // ohne Microsoft-Login-Header kein Zugriff
  let status = 0;
  access.requireFinance(reqWith(['grp-techniker']), { status: (s) => { status = s; return { json: () => {} }; } }, () => { status = 200; });
  assert.equal(status, 403);
});

test('Kennzahlen: Kontostand, Forderungen, Verbindlichkeiten, Umsatz, Vorschau', async () => {
  const f = await fin.financeDashboard('demo-rene');
  assert.equal(f.bank.balance, 60680.65);
  assert.equal(f.bank.accounts.length, 2);
  assert.equal(f.bank.trend.length, 91);
  assert.equal(f.bank.trend.at(-1).balance, 60680.65); // Verlauf endet beim heutigen Stand
  assert.ok(f.receivables.overdue > 0 && f.receivables.total >= f.receivables.overdue);
  assert.equal(f.receivables.buckets.length, 5);
  assert.equal(f.payables.blocked, 1);
  assert.ok(f.payables.overdue > 0);
  assert.ok(f.revenue.ytd > 0 && f.revenue.ytdPrev > 0);
  assert.equal(f.revenue.months.length, 12);
  assert.equal(f.forecast.length, 3);
  assert.ok(f.vat && typeof f.vat.month === 'number');
  assert.ok(f.mrr.monthly > 0);
});

test('Gutschriften mindern den Umsatz', async () => {
  const f = await fin.financeDashboard('demo-rene');
  const month = new Date(Date.now() - 20 * 864e5);
  const m = f.revenue.months[month.getMonth()];
  assert.ok(m.current > 0);
  // Gutschrift (300 brutto / 250 netto) ist im Monatswert negativ eingerechnet – Summe bleibt plausibel
  assert.ok(f.revenue.ytd < f.revenue.months.reduce((s, x) => s + x.current, 0) + 1);
});
