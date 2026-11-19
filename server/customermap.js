// Kundenzuordnung Atera-Kunde -> weclapp-Kunde.
// Reihenfolge: 1) im Cockpit bestätigte Zuordnung (DATA_DIR/customer-map.json)
// 2) Atera-Kundenfeld "weclapp-Kundennummer"  3) exakt gleicher Firmenname.
// Vorschläge über einen unscharfen Namensvergleich (ohne Rechtsform, Sonderzeichen).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { request, unwrap } from './weclapp.js';
import * as atera from './atera.js';

const get = (token, p, query) => request(token, 'GET', p, { query }).then(unwrap);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const file = path.join(config.dataDir, 'customer-map.json');
const loadMap = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const saveMap = (m) => fs.writeFileSync(file, JSON.stringify(m, null, 2));

const partyName = (p) => p.company || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.customerNumber || `Kunde ${p.id}`;

// ---------- weclapp-Kunden (gepuffert) ----------
let partyCache = { at: 0, rows: null };
export async function weclappCustomers(token) {
  if (partyCache.rows && Date.now() - partyCache.at < 600e3) return partyCache.rows;
  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const r = await get(token, '/party', { 'customer-eq': true, properties: 'id,company,firstName,lastName,customerNumber', pageSize: 1000, page });
    rows.push(...r);
    if (r.length < 1000) break;
  }
  partyCache = { at: Date.now(), rows: rows.map((p) => ({ id: String(p.id), name: partyName(p), number: p.customerNumber || '' })) };
  return partyCache.rows;
}

// ---------- unscharfer Namensvergleich ----------
const LEGAL = /\b(gmbh|gesmbh|ges\.?m\.?b\.?h|ag|kg|og|e\.?u|e\.?v|eu|ohg|gbr|ug|co|kgaa|mbh|ltd|inc|llc|sarl|se|und|and|the|der|die|das|fa|firma)\b/g;
export function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
}
export function similarity(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  const inter = [...ta].filter((t) => tb.has(t) || [...tb].some((u) => (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u)))).length;
  const jacc = inter / new Set([...ta, ...tb]).size;
  const cover = inter / Math.min(ta.size, tb.size); // kurzer Name komplett im langen enthalten
  const compact = na.replace(/ /g, ''), compactB = nb.replace(/ /g, '');
  const contains = compact.length >= 4 && compactB.length >= 4 && (compact.includes(compactB) || compactB.includes(compact)) ? 0.85 : 0;
  return Math.max(contains, Math.round((0.5 * jacc + 0.5 * cover) * 100) / 100);
}
export function bestMatches(name, parties, n = 3) {
  return parties.map((p) => ({ ...p, score: similarity(name, p.name) }))
    .filter((p) => p.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, n);
}

// ---------- Auflösen für die Kundenansicht ----------
export async function resolveParty(token, ateraCustomer) {
  const m = loadMap()[String(ateraCustomer.id)];
  if (m?.partyId) return { id: m.partyId, name: m.name, number: m.number, matchedBy: 'cockpit' };
  const number = await atera.customerNumber(ateraCustomer.id);
  const props = 'id,company,firstName,lastName,customerNumber';
  if (number) {
    const [p] = await get(token, '/party', { 'customerNumber-eq': number, properties: props, pageSize: 1 });
    if (p) return { id: String(p.id), name: partyName(p), number: p.customerNumber, matchedBy: 'atera-feld' };
  }
  const rows = await get(token, '/party', { 'company-ilike': ateraCustomer.name.trim(), properties: props, pageSize: 2 });
  if (rows.length === 1) return { id: String(rows[0].id), name: partyName(rows[0]), number: rows[0].customerNumber, matchedBy: 'name' };
  return null;
}

/** Übersicht aller Atera-Kunden der Ampel mit aktueller Zuordnung und Vorschlägen */
export async function mappingOverview(token) {
  const c = await atera.overview();
  const parties = await weclappCustomers(token);
  const byNumber = new Map(parties.filter((p) => p.number).map((p) => [String(p.number).toLowerCase(), p]));
  const byNorm = new Map();
  for (const p of parties) { const k = normName(p.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(p); }
  const map = loadMap();
  const out = [];
  for (const cu of c.customers || []) {
    const m = map[String(cu.id)];
    let current = null;
    if (m?.partyId) current = { ...m, id: m.partyId, matchedBy: 'cockpit' };
    else {
      const nr = await atera.customerNumber(cu.id);
      const p = nr && byNumber.get(String(nr).toLowerCase());
      if (p) current = { ...p, matchedBy: 'atera-feld' };
      else if (nr) current = { id: null, number: nr, name: 'Nummer aus Atera nicht in weclapp gefunden', matchedBy: 'atera-feld-fehlt' };
      else {
        const exact = parties.filter((x) => x.name.trim().toLowerCase() === cu.name.trim().toLowerCase());
        if (exact.length === 1) current = { ...exact[0], matchedBy: 'name' };
      }
    }
    const suggestions = current?.id ? [] : bestMatches(cu.name, parties);
    out.push({ ateraId: String(cu.id), name: cu.name, status: cu.status, current, suggestions });
  }
  out.sort((a, b) => (a.current?.id ? 1 : 0) - (b.current?.id ? 1 : 0) || a.name.localeCompare(b.name, 'de'));
  return { customers: out, partyCount: parties.length };
}

export async function searchParties(token, q) {
  const term = normName(q);
  if (term.length < 2) return [];
  const parties = await weclappCustomers(token);
  return parties.map((p) => ({ ...p, score: Math.max(similarity(q, p.name), String(p.number).toLowerCase().includes(String(q).toLowerCase().trim()) ? 0.99 : 0, normName(p.name).includes(term) ? 0.9 : 0) }))
    .filter((p) => p.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, 15);
}

export async function setMapping(token, ateraId, partyId, session) {
  const m = loadMap();
  if (!partyId) delete m[String(ateraId)];
  else {
    const p = (await weclappCustomers(token)).find((x) => x.id === String(partyId));
    if (!p) throw bad('weclapp-Kunde nicht gefunden', 404);
    m[String(ateraId)] = { partyId: p.id, number: p.number, name: p.name, by: session.name, at: Date.now() };
  }
  saveMap(m);
  return { ok: true };
}
