// Wartungsverträge: Übersicht je Kunde, Kunden ohne Vertrag, Rentabilität.
// Nur für die Entra-Gruppe Finanzen (Route mit requireFinance).
//
// Rechnung je Kunde im gewählten Zeitraum:
//   Ertrag        = wiederkehrender Vertragswert, anteilig für die Laufzeit im Zeitraum
//   Lizenzkosten  = Kostenpositionen des Vertrags (weclapp „Kosten“), sonst
//                   Menge × Einkaufspreis des Artikels (Bezugsquelle bzw. Kalkulationspreis)
//   Stundenkosten = nie fakturierte Stunden × interner Stundensatz, nur bei Verträgen mit eigener Leistung
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
  const ids = articles.map((a) => String(a.id));
  const sources = [];
  for (let i = 0; i < ids.length; i += 100) {
    sources.push(...await get(token, '/articleSupplySource', { 'articleId-in': JSON.stringify(ids.slice(i, i + 100)), properties: 'id,articleId,articlePrices', pageSize: 1000 }));
  }
  const byArticle = {};
  for (const s of sources) (byArticle[s.articleId] ||= []).push({ id: String(s.id), price: currentPrice(s.articlePrices, now) });
  const out = {}, stats = { articles: articles.length, withSource: 0, fromSource: 0, fromCalc: 0, none: 0 };
  for (const a of articles) {
    const list = byArticle[a.id] || [];
    if (list.length) stats.withSource++;
    const refs = new Set([a.primarySupplySourceId, ...(a.supplySources || []).flatMap((x) => [x.articleSupplySourceId, x.id])].filter(Boolean).map(String));
    const primary = list.find((x) => refs.has(x.id) && x.price != null && String(a.primarySupplySourceId) === x.id)?.price;
    const anyPrices = list.map((x) => x.price).filter((p) => p != null);
    const calc = currentPrice((a.articleCalculationPrices || []).filter((p) => !p.articleCalculationPriceType || p.articleCalculationPriceType === 'CALCULATION_PRICE'), now);
    const p = primary ?? (anyPrices.length ? Math.min(...anyPrices) : null);
    if (p != null) { out[a.id] = p; stats.fromSource++; } else if (calc != null) { out[a.id] = calc; stats.fromCalc++; } else stats.none++;
  }
  return { prices: out, stats };
}

/** Kunde einer Zeitbuchung: direkt, sonst über Ticket, Aufgabe (-> Kunde oder Ticket) oder Auftrag */
async function attributeRecords(token, records) {
  const stats = { total: records.length, direct: 0, ticket: 0, task: 0, order: 0, none: 0 };
  const need = (f) => [...new Set(records.filter((r) => !r.customerId && r[f]).map((r) => String(r[f])))];
  const safe = (p) => p.catch(() => []);
  const tasks = await safe(byIds(token, '/task', need('taskId'), 'id,customerId,ticketId,entityReferences'));
  const taskById = Object.fromEntries(tasks.map((t) => [String(t.id), t]));
  const taskTicket = (t) => t?.ticketId || (t?.entityReferences || []).find((e) => /ticket/i.test(e.entityName || ''))?.entityId;
  const ticketIds = [...need('ticketId'), ...tasks.filter((t) => !t.customerId).map(taskTicket).filter(Boolean).map(String)];
  const tickets = await safe(byIds(token, '/ticket', ticketIds, 'id,partyId'));
  const ticketParty = Object.fromEntries(tickets.map((t) => [String(t.id), t.partyId]));
  const orders = await safe(byIds(token, '/salesOrder', need('salesOrderId'), 'id,customerId'));
  const orderParty = Object.fromEntries(orders.map((o) => [String(o.id), o.customerId]));
  for (const r of records) {
    let p = r.customerId, via = 'direct';
    if (!p && r.ticketId) { p = ticketParty[r.ticketId]; via = 'ticket'; }
    if (!p && r.taskId) { const t = taskById[r.taskId]; p = t?.customerId || ticketParty[taskTicket(t)]; via = 'task'; }
    if (!p && r.salesOrderId) { p = orderParty[r.salesOrderId]; via = 'order'; }
    if (p) { r.customerId = String(p); stats[via]++; } else stats.none++;
  }
  return stats;
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
  let articles = [], prices = {}, priceStats = null, articleError = null;
  try {
    articles = articleIds.length ? await byIds(token, '/article', articleIds, 'id,articleNumber,name,articleType,articleCategoryId,supplySources,primarySupplySourceId,articleCalculationPrices') : [];
    ({ prices, stats: priceStats } = await purchasePrices(token, articles, now));
  } catch (e) { articleError = errText(e); notes.push(`Einkaufspreise der Artikel nicht lesbar (${articleError}) – Lizenzkosten nur aus Vertrags-Kostenpositionen.`); }
  const article = Object.fromEntries(articles.map((a) => [String(a.id), a]));
  const categories = await get(token, '/articleCategory', { pageSize: 1000, properties: 'id,name' }).catch(() => []);
  const categoryName = Object.fromEntries(categories.map((c) => [String(c.id), c.name || '']));
  const servicePattern = new RegExp(config.maintenanceArticlePattern || 'wartung', 'i');
  // Eigene Leistung (trägt Stunden): Dienstleistungsartikel ohne Einkaufspreis oder Wartungsartikel
  const isService = (articleId) => {
    const a = article[String(articleId)];
    if (!a) return false;
    if (servicePattern.test(`${a.name || ''} ${categoryName[a.articleCategoryId] || ''}`)) return true;
    return a.articleType === 'SERVICE' && prices[String(a.id)] == null;
  };

  // Stunden im Zeitraum, alle Kunden (auch für „ohne Vertrag“)
  let records = [], hoursError = null, hourStats = null;
  try {
    records = await all(token, '/timeRecord', { 'startDate-ge': from, properties: 'id,customerId,ticketId,taskId,salesOrderId,salesInvoiceId,billableInvoiceStatus,startDate,durationSeconds,billable,billableDurationSeconds' });
    hourStats = await attributeRecords(token, records);
    records = records.filter((r) => r.customerId);
  } catch (e) { hoursError = errText(e); notes.push(`Zeitbuchungen nicht lesbar (${hoursError}) – Stundenkosten fehlen.`); }

  // ---------- Kunden mit Vertrag ----------
  const byParty = new Map();
  const missingArticles = new Map(); // Artikel ohne Einkaufspreis (zum Nachpflegen)
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
        if (p == null) {
          const a = article[String(it.articleId)];
          if (a && !isService(it.articleId)) {
            const x = missingArticles.get(String(a.id)) || { id: String(a.id), number: a.articleNumber || '', name: a.name || '', contracts: 0 };
            x.contracts++;
            missingArticles.set(x.id, x);
          }
          continue;
        }
        monthlyCost += p * n(it.quantity || 1) * (INTERVAL_PER_MONTH[it.interval] ?? 0);
      }
    }
    const m = activeMonths(c, from, now);
    const carriesHours = items.some((it) => isService(it.articleId));
    const entry = byParty.get(String(c.partyId)) || { partyId: String(c.partyId), since: now, serviceSince: null, contracts: [], monthly: 0, monthlyCost: 0, revenue: 0, licenseCost: 0 };
    if (carriesHours) entry.serviceSince = Math.min(entry.serviceSince ?? now, Math.max(n(c.startDate) || from, from));
    entry.contracts.push({
      id: c.id, number: c.contractNumber || '', name: c.name || '', types: (c.types || []).map((t) => typeName[t.id] || '').filter(Boolean),
      start: n(c.startDate) || null, end: c.unlimited ? null : n(c.endDate) || null, unlimited: Boolean(c.unlimited) || !n(c.endDate),
      termination: n(c.latestPossibleTerminationDate) || null,
      monthly: r2(monthly), monthlyCost: r2(monthlyCost), costSource, carriesHours,
      items: items.map((it) => {
        const p = prices[String(it.articleId)];
        return {
          title: it.title || article[String(it.articleId)]?.name || 'Position', quantity: n(it.quantity || 1), monthly: r2(itemMonthly(it)),
          service: isService(it.articleId), purchase: p != null ? r2(p * n(it.quantity || 1) * (INTERVAL_PER_MONTH[it.interval] ?? 0)) : null,
        };
      }),
    });
    entry.since = Math.min(entry.since, Math.max(n(c.startDate) || from, from));
    entry.monthly += monthly;
    entry.monthlyCost += monthlyCost;
    entry.revenue += monthly * m;
    entry.licenseCost += monthlyCost * m;
    byParty.set(entry.partyId, entry);
  }

  // Stunden je Kunde – bei Vertragskunden erst ab Vertragsbeginn, damit Ertrag und Aufwand denselben Zeitraum haben
  // Vom Vertrag abgedeckt = nie fakturiert. Verrechenbare Stunden der letzten 45 Tage ohne Rechnung
  // sind vermutlich nur noch nicht abgerechnet ("offen") und zählen nicht gegen den Vertrag.
  const hoursByParty = {};
  for (const r of records) {
    const e = byParty.get(String(r.customerId));
    const since = e ? (e.serviceSince ?? e.since) : from;
    if (n(r.startDate) < since) continue;
    const h = (hoursByParty[r.customerId] ||= { total: 0, invoiced: 0, open: 0, covered: 0 });
    const dur = n(r.durationSeconds) / 3600;
    const billable = n(r.billableDurationSeconds ?? (r.billable ? r.durationSeconds : 0)) / 3600;
    h.total += dur;
    if (r.salesInvoiceId || r.billableInvoiceStatus === 'INVOICED' || r.billableInvoiceStatus === 'PARTLY_INVOICED') h.invoiced += dur;
    else if (billable > 0 && now - n(r.startDate) < 45 * D) h.open += dur;
    else h.covered += dur;
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

  const customers = [...byParty.values()].map((e) => {
    const h = hoursByParty[e.partyId];
    // Nur Verträge mit eigener Leistung tragen Stunden; reine Lizenz-/Aboverträge nicht
    const hoursCounted = e.serviceSince == null || !h ? 0 : countAll ? h.total : h.covered;
    const laborCost = hoursCounted * rate;
    const margin = e.revenue - e.licenseCost - laborCost;
    return {
      partyId: e.partyId, since: e.since > from ? e.since : null, carriesHours: e.serviceSince != null, name: party[e.partyId] ? partyName(party[e.partyId]) : `Kunde ${e.partyId}`, number: party[e.partyId]?.customerNumber || '',
      contracts: e.contracts, monthly: r2(e.monthly), monthlyCost: r2(e.monthlyCost),
      revenue: r2(e.revenue), licenseCost: r2(e.licenseCost),
      hoursTotal: r2(h?.total || 0), hoursInvoiced: r2(h?.invoiced || 0), hoursOpen: r2(h?.open || 0), hoursCounted: r2(hoursCounted), laborCost: r2(laborCost),
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
          revenue12: r2(c.revenue12), hours: r2(h?.total || 0), hoursInvoiced: r2(h?.invoiced || 0), hoursUnbilled: r2((h?.covered || 0) + (h?.open || 0)), atera: c.atera, otherContract: anyContract.has(id),
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

  const missing = [...missingArticles.values()].sort((a, b) => b.contracts - a.contracts || a.name.localeCompare(b.name, 'de'));
  if (missing.length) notes.push(`${missing.length} Artikel ohne Einkaufspreis – mit 0 € Lizenzkosten gerechnet (Liste unten).`);
  notes.push(
    'Ertrag = wiederkehrender Vertragswert (netto), anteilig für die Laufzeit im Zeitraum. Einmalige Positionen zählen nicht.',
    'Lizenzkosten = Kostenpositionen im weclapp-Vertrag; fehlen diese, Menge × Einkaufspreis des Artikels (Bezugsquelle, sonst Kalkulationspreis).',
    'Stunden tragen nur Verträge mit eigener Leistung: Dienstleistungsartikel ohne Einkaufspreis oder Artikel/Kategorie mit „Wartung“ im Namen. Reine Lizenz- und Aboverträge zeigen nur die Lizenzmarge.',
    countAll
      ? `Stundenkosten = alle beim Kunden gebuchten Stunden × ${rate} €/h.`
      : `Stundenkosten = nie fakturierte Stunden × ${rate} €/h. Fakturierte Stunden zählen nicht; verrechenbare Stunden der letzten 45 Tage ohne Rechnung gelten als „noch offen“ und zählen ebenfalls nicht.`,
    'Kunden ohne Vertrag = Kunden mit Rechnungen in den letzten 12 Monaten, mit Zeitbuchungen im Zeitraum oder in Atera verwaltet.',
  );

  // Datengrundlage – damit fehlende Stunden/Preise in weclapp nachvollziehbar sind
  const withCost = contracts.filter((c) => (c.contractCostItems || []).some((it) => itemMonthly(it) > 0)).length;
  const diag = [
    `Verträge: ${contracts.length}, davon ${withCost} mit Kostenpositionen (Lizenzkosten direkt aus dem Vertrag).`,
    priceStats && `Artikel in Vertragspositionen: ${priceStats.articles} – mit Bezugsquelle ${priceStats.withSource}, Einkaufspreis aus Bezugsquelle ${priceStats.fromSource}, aus Kalkulationspreis ${priceStats.fromCalc}, ohne Preis ${priceStats.none}.`,
    hourStats && `Zeitbuchungen im Zeitraum: ${hourStats.total} – Kunde direkt ${hourStats.direct}, über Ticket ${hourStats.ticket}, über Aufgabe ${hourStats.task}, über Auftrag ${hourStats.order}, ohne Kundenbezug ${hourStats.none}.`,
  ].filter(Boolean);

  return {
    generatedAt: now, period: { from, to: now, months }, rate, hours: countAll ? 'all' : 'unbilled',
    types: types.map((t) => ({ ...t, count: typeCounts[t.id] || 0 })).filter((t) => t.count || t.active), selectedType: type ? String(type) : '',
    hoursError, articleError, totals, customers, without, notes, diag, missingPrices: missing,
  };
}
