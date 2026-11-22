// Wartungsverträge: Übersicht je Kunde, Kunden ohne Vertrag, Rentabilität.
// Nur für die Entra-Gruppe Finanzen (Route mit requireFinance).
//
// Rechnung je Kunde im gewählten Zeitraum:
//   Ertrag        = wiederkehrender Vertragswert, anteilig für die Laufzeit im Zeitraum
//   Lizenzkosten  = Kostenpositionen des Vertrags (weclapp „Kosten“), sonst
//                   Menge × Einkaufspreis des Artikels (Bezugsquelle bzw. Kalkulationspreis)
//   Stundenkosten = gebuchte Stunden beim Kunden × interner Stundensatz
//                   (Standard: nur NICHT verrechenbare Stunden – verrechenbare werden extra fakturiert)
//   Marge         = Ertrag − Lizenzkosten − Stundenkosten
import { config } from './config.js';
import { request, unwrap } from './weclapp.js';
import { activeContracts, contractTypes } from './contracts.js';
import { mappingOverview } from './customermap.js';

const get = (token, p, query) => request(token, 'GET', p, { query }).then(unwrap);
const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (x) => Math.round(x * 100) / 100;
const D = 864e5;
const MONTH = 30.4375 * D;
const errText = (e) => (e.status === 403 ? 'Keine Berechtigung in weclapp' : e.message);

export const INTERVAL_PER_MONTH = { DAILY: 30, WEEKLY: 52 / 12, MONTHLY: 1, QUARTER: 1 / 3, HALF_YEARLY: 1 / 6, YEARLY: 1 / 12, TWO_YEARLY: 1 / 24, THREE_YEARLY: 1 / 36, FOUR_YEARLY: 1 / 48, FIVE_YEARLY: 1 / 60 };

async function all(token, path, query, max = 20) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const rows = await get(token, path, { ...query, pageSize: 1000, page });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function byIds(token, path, ids, properties) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const out = [];
  for (let i = 0; i < uniq.length; i += 100) {
    out.push(...await get(token, path, { 'id-in': JSON.stringify(uniq.slice(i, i + 100)), properties, pageSize: 100 }));
  }
  return out;
}

const partyName = (p) => p.company || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.customerNumber || `Kunde ${p.id}`;

/** Monatswert einer (Vertrags- oder Kosten-)Position; einmalige Positionen zählen nicht */
export function itemMonthly(it) {
  if (it.intervalType && it.intervalType !== 'RECURRENT') return 0;
  const f = INTERVAL_PER_MONTH[it.interval] ?? 0;
  const net = it.netAmount != null && it.netAmount !== '' ? n(it.netAmount) : n(it.unitPrice) * n(it.quantity || 1);
  return net * f;
}

/** Monate, in denen der Vertrag im Zeitraum [from, to] lief */
export function activeMonths(c, from, to) {
  const start = Math.max(n(c.startDate) || from, from);
  const end = Math.min(c.unlimited || !n(c.endDate) ? to : n(c.endDate), to);
  return Math.max(0, (end - start) / MONTH);
}

/** Gültiger Einkaufspreis aus einer Preisliste (heute gültig, kleinste Staffel) */
export function currentPrice(prices, now = Date.now()) {
  const valid = (prices || []).filter((p) => (!n(p.startDate) || n(p.startDate) <= now) && (!n(p.endDate) || n(p.endDate) >= now) && p.price != null);
  valid.sort((a, b) => n(a.priceScaleValue) - n(b.priceScaleValue));
  return valid.length ? n(valid[0].price) : null;
}

/** Einkaufspreise je Artikel: primäre Bezugsquelle, sonst günstigste, sonst Kalkulationspreis */
async function purchasePrices(token, articles, now) {
  const sourceIds = articles.flatMap((a) => (a.supplySources || []).map((s) => s.articleSupplySourceId || s.id));
  const sources = sourceIds.length ? await byIds(token, '/articleSupplySource', sourceIds, 'id,articleId,articlePrices') : [];
  const priceBySource = new Map(sources.map((s) => [String(s.id), currentPrice(s.articlePrices, now)]));
  const out = {};
  for (const a of articles) {
    const ids = (a.supplySources || []).map((s) => String(s.articleSupplySourceId || s.id));
    const primary = a.primarySupplySourceId && priceBySource.get(String(a.primarySupplySourceId));
    const anyPrices = ids.map((id) => priceBySource.get(id)).filter((p) => p != null);
    const calc = currentPrice((a.articleCalculationPrices || []).filter((p) => !p.articleCalculationPriceType || p.articleCalculationPriceType === 'CALCULATION_PRICE'), now);
    out[a.id] = primary ?? (anyPrices.length ? Math.min(...anyPrices) : calc);
  }
  return out;
}

export async function maintenanceReport(token, { months = 12, rate, type = '', hours = 'nonbillable', now = Date.now() } = {}) {
  months = [3, 6, 12, 24].includes(Number(months)) ? Number(months) : 12;
  rate = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : config.internalHourlyCost;
  const countAll = hours === 'all';
  const today = new Date(now);
  const from = new Date(today.getFullYear(), today.getMonth() - months, today.getDate()).getTime();
  const from12 = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).getTime();
  const notes = [];

  const [allContracts, types] = await Promise.all([activeContracts(token), contractTypes(token).catch(() => [])]);
  const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
  const typeCounts = {};
  for (const c of allContracts) for (const t of c.types || []) typeCounts[t.id] = (typeCounts[t.id] || 0) + 1;
  const contracts = type ? allContracts.filter((c) => (c.types || []).some((t) => String(t.id) === String(type))) : allContracts;

  // Artikel (Namen + Einkaufspreise) für Positionen ohne eigene Kostenpositionen
  const articleIds = contracts.flatMap((c) => (c.contractItems || []).map((it) => it.articleId));
  let articles = [], prices = {}, articleError = null;
  try {
    articles = articleIds.length ? await byIds(token, '/article', articleIds, 'id,articleNumber,name,articleType,supplySources,primarySupplySourceId,articleCalculationPrices') : [];
    prices = await purchasePrices(token, articles, now);
  } catch (e) { articleError = errText(e); notes.push(`Einkaufspreise der Artikel nicht lesbar (${articleError}) – Lizenzkosten nur aus Vertrags-Kostenpositionen.`); }
  const article = Object.fromEntries(articles.map((a) => [String(a.id), a]));

  // Stunden im Zeitraum, alle Kunden (auch für „ohne Vertrag“)
  let records = [], hoursError = null;
  try {
    records = (await all(token, '/timeRecord', { 'startDate-ge': from, properties: 'id,customerId,startDate,durationSeconds,billable,billableDurationSeconds' })).filter((r) => r.customerId);
  } catch (e) { hoursError = errText(e); notes.push(`Zeitbuchungen nicht lesbar (${hoursError}) – Stundenkosten fehlen.`); }

  // ---------- Kunden mit Vertrag ----------
  const byParty = new Map();
  let missingPrice = 0;
  for (const c of contracts) {
    const items = (c.contractItems || []).filter((it) => itemMonthly(it) > 0);
    const costItems = (c.contractCostItems || []).filter((it) => itemMonthly(it) > 0);
    const monthly = items.reduce((s, it) => s + itemMonthly(it), 0);
    let monthlyCost = 0, costSource = 'vertrag';
    if (costItems.length) monthlyCost = costItems.reduce((s, it) => s + itemMonthly(it), 0);
    else {
      costSource = 'einkauf';
      for (const it of items) {
        const p = prices[String(it.articleId)];
        if (p == null) { if (article[String(it.articleId)]?.articleType !== 'SERVICE') missingPrice++; continue; }
        monthlyCost += p * n(it.quantity || 1) * (INTERVAL_PER_MONTH[it.interval] ?? 0);
      }
    }
    const m = activeMonths(c, from, now);
    const entry = byParty.get(String(c.partyId)) || { partyId: String(c.partyId), since: now, contracts: [], monthly: 0, monthlyCost: 0, revenue: 0, licenseCost: 0 };
    entry.contracts.push({
      id: c.id, number: c.contractNumber || '', name: c.name || '', types: (c.types || []).map((t) => typeName[t.id] || '').filter(Boolean),
      start: n(c.startDate) || null, end: c.unlimited ? null : n(c.endDate) || null, unlimited: Boolean(c.unlimited) || !n(c.endDate),
      termination: n(c.latestPossibleTerminationDate) || null,
      monthly: r2(monthly), monthlyCost: r2(monthlyCost), costSource,
      items: items.map((it) => ({ title: it.title || article[String(it.articleId)]?.name || 'Position', quantity: n(it.quantity || 1), monthly: r2(itemMonthly(it)) })),
    });
    entry.since = Math.min(entry.since, Math.max(n(c.startDate) || from, from));
    entry.monthly += monthly;
    entry.monthlyCost += monthlyCost;
    entry.revenue += monthly * m;
    entry.licenseCost += monthlyCost * m;
    byParty.set(entry.partyId, entry);
  }

  // Stunden je Kunde – bei Vertragskunden erst ab Vertragsbeginn, damit Ertrag und Aufwand denselben Zeitraum haben
  const hoursByParty = {};
  for (const r of records) {
    const since = byParty.get(String(r.customerId))?.since ?? from;
    if (n(r.startDate) < since) continue;
    const h = (hoursByParty[r.customerId] ||= { total: 0, billable: 0 });
    h.total += n(r.durationSeconds) / 3600;
    h.billable += n(r.billableDurationSeconds ?? (r.billable ? r.durationSeconds : 0)) / 3600;
  }

  // ---------- Kunden ohne Vertrag ----------
  const candidates = new Map(); // partyId -> { revenue12, atera }
  let withoutError = null;
  try {
    const inv = await all(token, '/salesInvoice', { 'invoiceDate-ge': from12, properties: 'id,customerId,netAmount,salesInvoiceType,status' });
    for (const i of inv) {
      if (!i.customerId || i.status === 'CANCELLED') continue;
      const c = candidates.get(String(i.customerId)) || { revenue12: 0, atera: false };
      c.revenue12 += n(i.netAmount) * (/CREDIT_NOTE|CREDIT_ADVICE/.test(i.salesInvoiceType || '') ? -1 : 1);
      candidates.set(String(i.customerId), c);
    }
  } catch (e) { withoutError = errText(e); }
  try {
    const map = await mappingOverview(token);
    for (const cu of map.customers) {
      if (!cu.current?.id) continue;
      const c = candidates.get(String(cu.current.id)) || { revenue12: 0, atera: false };
      c.atera = true;
      candidates.set(String(cu.current.id), c);
    }
  } catch (e) { notes.push(`Atera-Kunden nicht abgeglichen (${e.message}).`); }
  for (const id of Object.keys(hoursByParty)) if (!candidates.has(id)) candidates.set(id, { revenue12: 0, atera: false });
  const anyContract = new Set(allContracts.map((c) => String(c.partyId)));
  const withoutIds = [...candidates.keys()].filter((id) => !byParty.has(id));

  // Namen
  const parties = await byIds(token, '/party', [...byParty.keys(), ...withoutIds], 'id,company,firstName,lastName,customerNumber,customer').catch(() => []);
  const party = Object.fromEntries(parties.map((p) => [String(p.id), p]));

  const counted = (h) => (h ? (countAll ? h.total : Math.max(0, h.total - h.billable)) : 0);
  const customers = [...byParty.values()].map((e) => {
    const h = hoursByParty[e.partyId];
    const hoursCounted = counted(h);
    const laborCost = hoursCounted * rate;
    const margin = e.revenue - e.licenseCost - laborCost;
    return {
      partyId: e.partyId, since: e.since > from ? e.since : null, name: party[e.partyId] ? partyName(party[e.partyId]) : `Kunde ${e.partyId}`, number: party[e.partyId]?.customerNumber || '',
      contracts: e.contracts, monthly: r2(e.monthly), monthlyCost: r2(e.monthlyCost),
      revenue: r2(e.revenue), licenseCost: r2(e.licenseCost),
      hoursTotal: r2(h?.total || 0), hoursBillable: r2(h?.billable || 0), hoursCounted: r2(hoursCounted), laborCost: r2(laborCost),
      margin: r2(margin), marginPct: e.revenue ? Math.round((margin / e.revenue) * 100) : null,
      // was eine Stunde nach Lizenzen tatsächlich bringt
      yieldPerHour: hoursCounted > 0.25 ? r2((e.revenue - e.licenseCost) / hoursCounted) : null,
    };
  }).sort((a, b) => a.margin - b.margin);

  const without = withoutError && !withoutIds.length ? { error: withoutError } : {
    rows: withoutIds
      .map((id) => {
        const c = candidates.get(id), h = hoursByParty[id];
        return {
          partyId: id, name: party[id] ? partyName(party[id]) : `Kunde ${id}`, number: party[id]?.customerNumber || '',
          revenue12: r2(c.revenue12), hours: r2(h?.total || 0), hoursBillable: r2(h?.billable || 0), atera: c.atera, otherContract: anyContract.has(id),
        };
      })
      .filter((x) => !party[x.partyId] || party[x.partyId].customer !== false)
      .sort((a, b) => Number(b.atera) - Number(a.atera) || b.hours - a.hours || b.revenue12 - a.revenue12),
  };
  if (withoutError) notes.push(`Ausgangsrechnungen nicht lesbar (${withoutError}) – „ohne Vertrag“ nur aus Atera und Zeitbuchungen.`);

  const sum = (f) => r2(customers.reduce((s, c) => s + c[f], 0));
  const totals = {
    contracts: contracts.length, customers: customers.length, monthly: sum('monthly'), monthlyCost: sum('monthlyCost'),
    revenue: sum('revenue'), licenseCost: sum('licenseCost'), hours: sum('hoursCounted'), hoursTotal: sum('hoursTotal'), laborCost: sum('laborCost'), margin: sum('margin'),
  };
  totals.marginPct = totals.revenue ? Math.round((totals.margin / totals.revenue) * 100) : null;
  totals.losing = customers.filter((c) => c.margin < 0).length;

  if (missingPrice) notes.push(`${missingPrice} Vertragsposition${missingPrice === 1 ? '' : 'en'} ohne Einkaufspreis und ohne Kostenposition – mit 0 € Lizenzkosten gerechnet.`);
  notes.push(
    'Ertrag = wiederkehrender Vertragswert (netto), anteilig für die Laufzeit im Zeitraum. Einmalige Positionen zählen nicht.',
    'Lizenzkosten = Kostenpositionen im weclapp-Vertrag; fehlen diese, Menge × Einkaufspreis des Artikels (Bezugsquelle, sonst Kalkulationspreis).',
    countAll
      ? `Stundenkosten = alle beim Kunden gebuchten Stunden × ${rate} €/h.`
      : `Stundenkosten = nicht verrechenbare Stunden × ${rate} €/h (verrechenbare Stunden werden extra fakturiert).`,
    'Kunden ohne Vertrag = Kunden mit Rechnungen in den letzten 12 Monaten, mit Zeitbuchungen im Zeitraum oder in Atera verwaltet.',
  );

  return {
    generatedAt: now, period: { from, to: now, months }, rate, hours: countAll ? 'all' : 'nonbillable',
    types: types.map((t) => ({ ...t, count: typeCounts[t.id] || 0 })).filter((t) => t.count || t.active), selectedType: type ? String(type) : '',
    hoursError, articleError, totals, customers, without, notes,
  };
}
