// Meldungen pausieren: Kunde oder Gerät zählt nicht mehr als kritisch, "bis behoben" endet von selbst
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DEMO = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-pause-'));
const { buildOverview } = await import('../server/atera.js');
const pz = await import('../server/pauses.js');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const seen = (ms) => new Date(NOW - ms).toISOString();
const srv = (i, cust, online = true) => ({ AgentID: i, DeviceGuid: `g${i}`, CustomerID: cust, CustomerName: `Kunde ${cust}`, MachineName: `SRV${i}`, OSType: 'Server', Online: online, LastSeen: seen(online ? 60000 : 3 * 3600e3) });
const ov = () => buildOverview({
  customers: [{ CustomerID: 1, CustomerName: 'Huber' }, { CustomerID: 2, CustomerName: 'Lang' }],
  agents: [srv(1, 1, false), srv(2, 1), srv(3, 2, false)],
  alerts: [{ DeviceGuid: 'g2', Severity: 'Warning', Title: 'Laufwerk C: fast voll', AlertID: 9 }],
}, NOW);
const find = (list, id) => list.find((c) => c.id === id);

test('Gerät pausiert: Kunde nur noch Warnung, Problem bleibt grau sichtbar', () => {
  const p = { key: 'device:g1', type: 'device', id: 'g1', until: null, untilOk: false };
  const { customers } = pz.applyPauses(ov(), { 'device:g1': p }, NOW);
  const huber = find(customers, 1);
  assert.equal(huber.status, 'warning');
  assert.equal(huber.counts.critical, 0);
  assert.equal(huber.pausedDevices, 1);
  const d = huber.devices.find((x) => x.guid === 'g1');
  assert.equal(d.status, 'ok');
  assert.equal(d.pausedStatus, 'critical');
  assert.match(d.pausedProblems[0].text, /offline/);
  assert.match(huber.headline, /SRV2: Laufwerk/);
  assert.equal(find(customers, 2).status, 'critical'); // anderer Kunde unverändert
});

test('Kunde pausiert: alles grün, eigentlicher Zustand gemerkt', () => {
  const p = { key: 'customer:1', type: 'customer', id: '1', until: null, untilOk: false };
  const { customers } = pz.applyPauses(ov(), { 'customer:1': p }, NOW);
  const huber = find(customers, 1);
  assert.equal(huber.status, 'ok');
  assert.equal(huber.pausedStatus, 'critical');
  assert.equal(huber.headline, null);
  assert.ok(huber.devices.every((d) => d.paused?.key === 'customer:1'));
});

test('"bis behoben" endet, sobald das Gerät wieder in Ordnung ist', () => {
  const pauses = { 'device:g3': { key: 'device:g3', type: 'device', id: 'g3', untilOk: true } };
  assert.deepEqual(pz.applyPauses(ov(), pauses, NOW).resolved, []);
  const fixed = buildOverview({ customers: [{ CustomerID: 2, CustomerName: 'Lang' }], agents: [srv(3, 2, true)], alerts: [] }, NOW);
  const r = pz.applyPauses(fixed, pauses, NOW);
  assert.deepEqual(r.resolved, ['device:g3']);
  assert.ok(!r.customers[0].devices[0].paused);
});

test('Speichern, Ablauf und Beenden', () => {
  const p = pz.setPause({ type: 'device', id: 'g1', customerId: 1, name: 'SRV1', customerName: 'Huber', duration: '1d', reason: 'Tausch' }, 'Rene', NOW);
  assert.equal(p.until, NOW + 864e5);
  assert.ok(pz.active(NOW + 1000)['device:g1']);
  assert.ok(!pz.active(NOW + 2 * 864e5)['device:g1']); // abgelaufen und entfernt
  pz.setPause({ type: 'customer', id: 2, name: 'Lang', duration: 'forever' }, 'Rene', NOW);
  assert.equal(pz.active(NOW + 400 * 864e5)['customer:2'].until, null);
  assert.equal(pz.removePause('customer:2'), true);
  assert.deepEqual(pz.active(NOW), {});
  assert.throws(() => pz.setPause({ type: 'device', id: 'g1', duration: '99y' }, 'Rene'), /Dauer/);
});
