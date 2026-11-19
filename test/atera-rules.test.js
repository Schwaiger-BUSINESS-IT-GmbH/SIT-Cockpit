// Ampel-Regeln: nur Server und Firewalls
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEMO = '1';
const { rateDevice, rateFirewall, isFirewall, buildOverview } = await import('../server/atera.js');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const seen = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000, H = 3600e3;
const srv = (i, cust, online = true, ms = MIN, extra = {}) => ({ AgentID: i, DeviceGuid: `g${i}`, CustomerID: cust, CustomerName: `Kunde ${cust}`, MachineName: `SRV${i}`, OSType: 'Server', Online: online, LastSeen: seen(ms), ...extra });
const ws = (i, cust, online = true, ms = MIN) => ({ AgentID: i, DeviceGuid: `g${i}`, CustomerID: cust, CustomerName: `Kunde ${cust}`, MachineName: `PC${i}`, OSType: 'Work Station', Online: online, LastSeen: seen(ms) });
const fw = (i, cust, Online = true, Type = 'Firewall', Name = `FW${i}`) => ({ DeviceID: i, DeviceGuid: `n${i}`, CustomerID: cust, CustomerName: `Kunde ${cust}`, Name, Type, Online });

test('Server 14 Min. offline = noch ok, 16 Min. = kritisch', () => {
  assert.equal(rateDevice(srv(1, 1, false, 14 * MIN), [], NOW).status, 'ok');
  assert.equal(rateDevice(srv(1, 1, false, 16 * MIN), [], NOW).status, 'critical');
  assert.equal(rateDevice({ OSType: 'Domain Controller', Online: false, LastSeen: seen(60 * MIN) }, [], NOW).status, 'critical');
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

test('Laufwerk unter 10 % = Warnung, unter 5 % = kritisch', () => {
  const disk = (free) => ({ OSType: 'Server', Online: true, HardwareDisks: [{ Drive: 'C:', Total: 100000, Free: free }] });
  assert.equal(rateDevice(disk(20000), [], NOW).status, 'ok');
  assert.equal(rateDevice(disk(8000), [], NOW).status, 'warning');
  assert.equal(rateDevice(disk(4000), [], NOW).status, 'critical');
});

test('Firewall-Erkennung: SNMP-Typ Firewall oder typischer Name, Drucker/Switches nicht', () => {
  assert.ok(isFirewall({ Type: 'Firewall', Name: 'x' }));
  assert.ok(isFirewall({ Name: 'FortiGate Zentrale' }));
  assert.ok(isFirewall({ Name: 'Firewall Kunde (Ping)' }));
  assert.ok(!isFirewall({ Type: 'Printer', Name: 'Drucker Empfang' }));
  assert.ok(!isFirewall({ Type: 'Switch', Name: 'Core-Switch' }));
});

test('Firewall nicht erreichbar = kritisch; Ping-Firewall nur über Alerts', () => {
  assert.equal(rateFirewall({ Online: false }, []).status, 'critical');
  assert.equal(rateFirewall({ Online: true }, []).status, 'ok');
  assert.equal(rateFirewall({}, []).status, 'ok');
  assert.equal(rateFirewall({}, [{ Severity: 'Critical', Title: 'Ping fehlgeschlagen' }]).status, 'critical');
});

test('Nur Server und Firewalls: Arbeitsplätze, Drucker und deren Alerts zählen nicht', () => {
  const out = buildOverview({
    customers: [{ CustomerID: 1, CustomerName: 'Mit Server' }, { CustomerID: 2, CustomerName: 'Nur PCs' }],
    agents: [srv(1, 1), ws(2, 1, false, 30 * 864e5), ws(3, 2, false, 30 * 864e5)],
    alerts: [{ DeviceGuid: 'g2', CustomerID: 1, Severity: 'Critical', Title: 'PC-Problem' }],
    net: { snmp: [fw(10, 1), { ...fw(11, 1, false, 'Printer', 'Drucker') }] },
  }, NOW);
  assert.equal(out.length, 1); // Kunde ohne Server/Firewall verschwindet
  assert.equal(out[0].status, 'ok');
  assert.deepEqual(out[0].devices.map((d) => d.kind).sort(), ['firewall', 'server']);
});

test('Möglicher Ausfall: Firewall nicht erreichbar und Server gleichzeitig offline', () => {
  const out = buildOverview({
    customers: [{ CustomerID: 1, CustomerName: 'A' }, { CustomerID: 2, CustomerName: 'B' }],
    agents: [srv(1, 1, false, 20 * MIN), srv(2, 2, true)],
    alerts: [],
    net: { snmp: [fw(10, 1, false), fw(11, 2, false)] },
  }, NOW);
  const a = out.find((c) => c.name === 'A'), b = out.find((c) => c.name === 'B');
  assert.equal(a.outage, true);
  assert.equal(a.status, 'critical');
  assert.equal(b.outage, false); // nur Firewall weg, Server läuft
  assert.equal(b.status, 'critical');
  assert.equal(b.firewallsDown, 1);
});

test('Sortierung: kritisch vor Warnung vor ok; archivierte Alerts ignoriert', () => {
  const out = buildOverview({
    customers: [{ CustomerID: 1, CustomerName: 'A ok' }, { CustomerID: 2, CustomerName: 'B warn' }, { CustomerID: 3, CustomerName: 'C crit' }],
    agents: [srv(1, 1), srv(2, 2), srv(3, 3)],
    alerts: [
      { DeviceGuid: 'g2', CustomerID: 2, Severity: 'Warning', Title: 'CPU' },
      { DeviceGuid: 'g3', CustomerID: 3, Severity: 'Critical', Title: 'Dienst' },
      { DeviceGuid: 'g1', CustomerID: 1, Severity: 'Critical', Title: 'alt', Archived: true },
    ],
  }, NOW);
  assert.deepEqual(out.map((c) => c.status), ['critical', 'warning', 'ok']);
});

test('Server länger als 30 Tage offline = veraltet, kein Alarm', () => {
  const r = rateDevice(srv(1, 1, false, 45 * 864e5), [{ Severity: 'Critical', Title: 'Agent nicht erreichbar' }], NOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.stale, true);
  const out = buildOverview({ customers: [{ CustomerID: 1, CustomerName: 'A' }], agents: [srv(1, 1, false, 45 * 864e5), srv(2, 1)], alerts: [] }, NOW);
  assert.equal(out[0].status, 'ok');
  assert.equal(out[0].servers, 1);
  assert.equal(out[0].staleServers, 1);
});

test('Ping-Firewall mit kritischem Alert zählt als nicht erreichbar', () => {
  const out = buildOverview({
    customers: [{ CustomerID: 1, CustomerName: 'A' }], agents: [],
    alerts: [{ DeviceGuid: 'n5', CustomerID: 1, Severity: 'Critical', Title: 'Ping fehlgeschlagen' }],
    net: { generic: [{ DeviceID: 5, DeviceGuid: 'n5', CustomerID: 1, Name: 'Firewall Zentrale' }] },
  }, NOW);
  assert.equal(out[0].firewallsDown, 1);
});
