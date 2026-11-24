// Security-Seite: Quellen lesen, Produkte und Kunden zuordnen, aktiv ausgenutzte Lücken markieren
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.PORT = '3393';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-sec-'));
const { securityMock } = await import('../server/mock/security.js');
const { ateraMock } = await import('../server/mock/atera.js');
const sec = await import('../server/security.js');

let server;
before(async () => {
  const app = express();
  app.use('/__mock/security', securityMock());
  app.use('/__mock/atera/api/v3', ateraMock());
  await new Promise((r) => { server = app.listen(3393, r); });
});
after(() => server.close());

test('Fortinet-RSS und CSAF werden gelesen', () => {
  const xml = `<rss><channel><item><title>Auth bypass - CVE-2026-1111</title><link>https://fortiguard.fortinet.com/psirt/FG-IR-26-001</link><description><![CDATA[<p><strong>CVSSv3 Score:</strong> 9.8</p><p>FortiOS bug. Revised on 2026-01-01</p>]]></description><pubDate>Tue, 10 Nov 2026 00:00:00 -0800</pubDate><csaf:link>https://x/csaf.json</csaf:link></item></channel></rss>`;
  const [it] = sec.parseFortinetRss(xml);
  assert.equal(it.id, 'FG-IR-26-001');
  assert.equal(it.cvss, 9.8);
  assert.deepEqual(it.cves, ['CVE-2026-1111']);
  assert.equal(it.csaf, 'https://x/csaf.json');
  const c = sec.parseCsaf({
    document: { title: 'T', tracking: { initial_release_date: '2026-11-10T00:00:00', current_release_date: '2026-11-11T00:00:00' } },
    product_tree: { branches: [{ branches: [{ product: { name: 'FortiOS 7.4.0' } }] }] },
    vulnerabilities: [{ cve: 'CVE-2026-1111', scores: [{ cvss_v3: { baseScore: 9 } }], product_status: { known_affected: ['FortiOS >=7.4.0|<=7.4.12'] }, remediations: [{ category: 'vendor_fix', details: 'FortiOS 7.4: Upgrade to 7.4.13 or above' }] }],
  });
  assert.deepEqual(c.products, ['FortiOS']);
  assert.deepEqual(c.fix, ['FortiOS 7.4: Upgrade to 7.4.13 or above']);
});

test('Synology-Advisories aus der Webseite, „Not affected“ erkannt', () => {
  const html = '<a href="security/advisory/Synology_SA_26_07">Synology-SA-26:07 DSM</a><span class="item_txt impact_txt">Moderate</span><span class="item_txt status_txt">Resolved</span><time>2026-05-11 16:51:59</time>'
    + '<a href="security/advisory/Synology_SA_26_08">Synology-SA-26:08 Linux Kernel</a><span class="item_txt impact_txt">Not affected</span><span class="item_txt status_txt">Resolved</span><time>2026-05-11 15:43:59</time>';
  const rows = sec.parseSynology(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'Synology-SA-26:07');
  assert.equal(rows[0].severity, 'medium');
  assert.equal(rows[1].notAffected, true);
});

test('Geräte werden Produkten und Kunden zugeordnet', () => {
  const { products } = sec.loadSettings();
  const inv = [
    { customerId: 1, customer: 'Huber', kind: 'firewall', name: 'FW-HUBER-FG60F', text: 'FW-HUBER-FG60F Firewall', os: '' },
    { customerId: 1, customer: 'Huber', kind: 'network', name: 'NAS-HUBER-DS923', text: 'NAS-HUBER-DS923 Storage', os: '' },
    { customerId: 2, customer: 'Lang', kind: 'server', name: 'LANG-DC', text: 'Windows Server 2022', os: 'Windows Server 2022 Standard' },
    { customerId: 2, customer: 'Lang', kind: 'network', name: 'Drucker', text: 'Drucker Printer', os: '' },
  ];
  const m = sec.matchInventory(products, inv);
  assert.deepEqual(m.fortigate.map((c) => c.name), ['Huber']);
  assert.deepEqual(m.synology.map((c) => c.name), ['Huber']);
  assert.deepEqual(m.windows.map((c) => c.name), ['Lang']);
});

test('Gesamtauswertung: aktiv ausgenutzt zuerst, Cloud-Dienste raus, KEV an Herstellermeldung', async () => {
  const r = await sec.securityReport({ days: 90, force: true });
  assert.ok(r.sources.every((s) => !s.error), JSON.stringify(r.sources));
  const keys = r.items.map((i) => i.key);
  // FortiOS-Meldung trägt die KEV-Info, kein doppelter KEV-Eintrag
  const fg = r.items.find((i) => i.key === 'fortinet:FG-IR-26-273');
  assert.equal(fg.exploited, true);
  assert.equal(fg.kev.ransomware, true);
  assert.ok(!keys.includes('kev:CVE-2026-90001'));
  assert.ok(fg.fix.some((f) => /7\.6\.8/.test(f)));
  // Azure (Microsoft behebt selbst) erscheint nicht, Exchange schon
  assert.ok(!r.items.some((i) => i.cves.includes('CVE-2026-96040')));
  const ex = r.items.find((i) => i.productId === 'exchange');
  assert.match(ex.title, /^Patchday November 2026 – Exchange/);
  // Windows-Patchday: eine Meldung, aktiv ausgenutzte Lücke oben in den Details
  const win = r.items.filter((i) => i.productId === 'windows' && i.source === 'msrc');
  assert.equal(win.length, 1);
  assert.equal(win[0].exploited, true);
  assert.equal(win[0].details[0].cve, 'CVE-2026-96951');
  assert.ok(!keys.includes('kev:CVE-2026-96951'));
  // Veeam: NVD-Eintrag mit KEV-Markierung
  assert.equal(r.items.find((i) => i.key === 'nvd:CVE-2026-77777').exploited, true);
  // nicht betroffen / fremde Hersteller fehlen
  assert.ok(!keys.some((k) => /Synology-SA-26:08|CVE-2020-29583/.test(k)));
  // älter als 90 Tage fehlt (Synology KEV vor 200 Tagen)
  assert.ok(!keys.includes('kev:CVE-2025-12345'));
  // Sortierung: aktiv ausgenutzte zuerst
  const firstNon = r.items.findIndex((i) => !i.exploited);
  assert.ok(r.items.slice(firstNon).every((i) => !i.exploited));
  // Kunden aus Atera: FortiGate-Kunden
  assert.ok(fg.customers.length >= 5);
  assert.ok(fg.epss != null);
  const syn = r.products.find((p) => p.id === 'synology');
  assert.equal(syn.customers, 2);
});

test('365 Tage zeigen auch ältere aktiv ausgenutzte Lücken', async () => {
  const r = await sec.securityReport({ days: 365 });
  assert.ok(r.items.some((i) => i.key === 'kev:CVE-2025-12345'));
});

test('Bearbeitungsstatus wird gespeichert', async () => {
  const s = sec.setStatus('fortinet:FG-IR-26-273', { status: 'done', note: 'Alle FortiGates auf 7.6.8' }, 'Rene');
  assert.equal(s.by, 'Rene');
  const r = await sec.securityReport({ days: 90 });
  assert.equal(r.items.find((i) => i.key === 'fortinet:FG-IR-26-273').status.status, 'done');
  assert.throws(() => sec.setStatus('x', { status: 'kaputt' }, 'Rene'));
});
