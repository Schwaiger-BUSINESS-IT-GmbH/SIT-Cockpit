// Regeln aus docs/anforderungen.md – Ampel für Geräte und Kunden
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEMO = '1';
const { rateDevice, buildOverview } = await import('../server/atera.js');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const seen = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000, D = 864e5;

test('Server 14 Min. offline = noch ok, 16 Min. = kritisch', () => {
  assert.equal(rateDevice({ OSType: 'Server', Online: false, LastSeen: seen(14 * MIN) }, [], NOW).status, 'ok');
  assert.equal(rateDevice({ OSType: 'Server', Online: false, LastSeen: seen(16 * MIN) }, [], NOW).status, 'critical');
  assert.equal(rateDevice({ OSType: 'Domain Controller', Online: false, LastSeen: seen(60 * MIN) }, [], NOW).status, 'critical');
});

test('Arbeitsplatz erst nach 7 Tagen offline = Warnung', () => {
  assert.equal(rateDevice({ OSType: 'Work Station', Online: false, LastSeen: seen(6 * D) }, [], NOW).status, 'ok');
  assert.equal(rateDevice({ OSType: 'Work Station', Online: false, LastSeen: seen(8 * D) }, [], NOW).status, 'warning');
});

test('Alerts: Critical/Warning zählen, Information nicht; Backup erkannt', () => {
  const r = rateDevice({ OSType: 'Server', Online: true }, [
    { Severity: 'Information', Title: 'Software installiert' },
    { Severity: 'Critical', Title: 'Backup-Job fehlgeschlagen', Created: seen(H) },
  ], NOW);
  assert.equal(r.status, 'critical');
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].kind, 'backup');
});
const H = 3600e3;

test('Laufwerk unter 10 % = Warnung, unter 5 % = kritisch', () => {
  const disk = (free) => ({ OSType: 'Server', Online: true, HardwareDisks: [{ Drive: 'C:', Total: 100000, Free: free }] });
  assert.equal(rateDevice(disk(20000), [], NOW).status, 'ok');
  assert.equal(rateDevice(disk(8000), [], NOW).status, 'warning');
  assert.equal(rateDevice(disk(4000), [], NOW).status, 'critical');
});

test('Möglicher Ausfall: >= 50 % und mind. 3 Geräte gleichzeitig offline', () => {
  const ag = (i, online, ms) => ({ AgentID: i, DeviceGuid: `g${i}`, CustomerID: 1, CustomerName: 'Test', MachineName: `PC${i}`, OSType: 'Work Station', Online: online, LastSeen: seen(ms) });
  const out = buildOverview({ customers: [{ CustomerID: 1, CustomerName: 'Test' }], agents: [ag(1, false, 20 * MIN), ag(2, false, 22 * MIN), ag(3, false, 25 * MIN), ag(4, true, MIN)], alerts: [] }, NOW);
  assert.equal(out[0].outage, true);
  assert.equal(out[0].status, 'critical');
  // betroffene Geräte erscheinen als Warnung, nicht als unauffällig
  assert.equal(out[0].devices.filter((d) => d.status === 'warning').length, 3);

  const two = buildOverview({ customers: [{ CustomerID: 1, CustomerName: 'Test' }], agents: [ag(1, false, 20 * MIN), ag(2, false, 22 * MIN), ag(3, true, MIN)], alerts: [] }, NOW);
  assert.equal(two[0].outage, false);
});

test('Sortierung: kritisch vor Warnung vor ok; archivierte Alerts ignoriert', () => {
  const out = buildOverview({
    customers: [{ CustomerID: 1, CustomerName: 'A ok' }, { CustomerID: 2, CustomerName: 'B warn' }, { CustomerID: 3, CustomerName: 'C crit' }],
    agents: [1, 2, 3].map((c) => ({ AgentID: c, DeviceGuid: `g${c}`, CustomerID: c, MachineName: `S${c}`, OSType: 'Server', Online: true })),
    alerts: [
      { DeviceGuid: 'g2', CustomerID: 2, Severity: 'Warning', Title: 'CPU' },
      { DeviceGuid: 'g3', CustomerID: 3, Severity: 'Critical', Title: 'Dienst' },
      { DeviceGuid: 'g1', CustomerID: 1, Severity: 'Critical', Title: 'alt', Archived: true },
    ],
  }, NOW);
  assert.deepEqual(out.map((c) => c.status), ['critical', 'warning', 'ok']);
});
