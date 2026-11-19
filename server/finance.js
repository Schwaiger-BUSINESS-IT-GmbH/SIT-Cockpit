// Finanz-Dashboard für Geschäftsführung und Buchhaltung (nur Entra-Gruppe).
// Quellen: weclapp – Bankkonten (inkl. weclapp-Bankanbindung), Bankbuchungen,
// Ausgangs- und Eingangsrechnungen, Verträge. Jeder Bereich lädt für sich;
// fehlt ein Recht in weclapp, bleibt nur dieser Bereich leer.
//
// Hinweise zur Genauigkeit (stehen auch im Dashboard):
//  - weclapp führt keinen offenen Restbetrag je Rechnung -> offene Rechnungen mit vollem Betrag.
//  - USt-Zahllast ist eine Näherung aus Rechnungsbeträgen, keine UVA.
import { request, unwrap } from './weclapp.js';
import { monthlyValue } from './sales.js';

const get = (token, p, query) => request(token, 'GET', p, { query }).then(unwrap);
const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const r2 = (x) => Math.round(x * 100) / 100;
const D = 864e5;
const section = (p) => p.catch((e) => ({ error: e.status === 403 ? 'Keine Berechtigung in weclapp' : e.message }));
const ok = (x) => x && !x.error;

async function all(token, path, query, max = 20) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const rows = await get(token, path, { ...query, pageSize: 1000, page });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function partyNames(token, ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const out = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const rows = await get(token, '/party', { 'id-in': JSON.stringify(uniq.slice(i, i + 100)), properties: 'id,company,firstName,lastName', pageSize: 100 }).catch(() => []);
    for (const p of rows) out[p.id] = p.company || [p.firstName, p.lastName].filter(Boolean).join(' ');
  }
  return out;
}

const sign = (type) => (/CREDIT_NOTE|CREDIT_ADVICE/.test(type || '') ? -1 : 1);
const monthKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export async function financeDashboard(token, now = Date.now()) {
  const today = new Date(now);
  const yearStart = new Date(today.getFullYear(), 0, 1).getTime();
  const lastYearStart = new Date(today.getFullYear() - 1, 0, 1).getTime();
  const days90 = now - 90 * D;

  const [accounts, transactions, receivables, payables, sales, purchases, contracts] = await Promise.all([
    section(get(token, '/bankAccount', { pageSize: 100, properties: 'id,accountHolder,creditInstitute,iban,balance,currencyId,lastDownload,connectionFailure,creditLine,primary,active,autoSync' })),
    section(all(token, '/bankTransaction', { 'effectiveDate-ge': days90, properties: 'id,amount,effectiveDate,paymentType' }, 10)),
    section(all(token, '/salesInvoice', {
      'paid-eq': false, 'status-in': JSON.stringify(['DOCUMENT_CREATED', 'OPEN_ITEM_CREATED']),
      properties: 'id,invoiceNumber,customerId,invoiceDate,dueDate,grossAmount,salesInvoiceType,paymentStatus',
    })),
    section(all(token, '/purchaseInvoice', {
      'status-in': JSON.stringify(['ENTRY_COMPLETED', 'INVOICE_CHECKED', 'DOCUMENT_CREATED', 'OPEN_ITEM_CREATED', 'INVOICE_VERIFICATION', 'INVOICE_RECEIVED']),
      'paymentStatus-in': JSON.stringify(['OPEN', 'UNKNOWN']),
      properties: 'id,invoiceNumber,internalInvoiceNumber,supplierId,invoiceDate,dueDate,grossAmount,purchaseInvoiceType,paymentStatus,paymentBlock',
    })),
    section(all(token, '/salesInvoice', {
      'invoiceDate-ge': lastYearStart, 'status-in': JSON.stringify(['DOCUMENT_CREATED', 'OPEN_ITEM_CREATED']),
      properties: 'id,invoiceDate,netAmount,vatAmount,salesInvoiceType',
    })),
    section(all(token, '/purchaseInvoice', {
      'invoiceDate-ge': lastYearStart, 'status-notin': JSON.stringify(['NEW', 'CANCELLED']),
      properties: 'id,invoiceDate,netAmount,vatAmount,purchaseInvoiceType',
    })),
    section(get(token, '/contract', { 'contractStatus-eq': 'ACTIVE', pageSize: 1000 })),
  ]);

  const out = { generatedAt: now, notes: [] };

  // ---------- Liquidität ----------
  if (ok(accounts)) {
    const act = accounts.filter((a) => a.active !== false);
    const balance = r2(act.reduce((s, a) => s + n(a.balance), 0));
    out.bank = {
      balance,
      creditLine: r2(act.reduce((s, a) => s + n(a.creditLine), 0)),
      accounts: act.map((a) => ({
        id: String(a.id), name: a.creditInstitute || a.accountHolder || 'Konto',
        iban: a.iban ? `${String(a.iban).slice(0, 4)} … ${String(a.iban).slice(-4)}` : '',
        balance: n(a.balance), lastSync: n(a.lastDownload) || null, failure: Boolean(a.connectionFailure), autoSync: a.autoSync !== false, primary: !!a.primary,
      })).sort((a, b) => b.balance - a.balance),
      stale: act.some((a) => a.lastDownload && now - n(a.lastDownload) > 3 * D),
    };
    // Verlauf 90 Tage: vom heutigen Stand rückwärts über die Buchungen
    if (ok(transactions)) {
      const perDay = new Map();
      for (const t of transactions) {
        const amt = Math.abs(n(t.amount)) * (t.paymentType === 'DISBURSEMENT' ? -1 : 1);
        const k = new Date(n(t.effectiveDate)).toDateString();
        perDay.set(k, (perDay.get(k) || 0) + amt);
      }
      const series = [];
      let bal = balance;
      for (let i = 0; i <= 90; i++) {
        const d = new Date(now - i * D);
        series.push({ date: d.getTime(), balance: r2(bal) });
        bal -= perDay.get(d.toDateString()) || 0;
      }
      out.bank.trend = series.reverse();
      out.bank.in90 = r2(transactions.filter((t) => t.paymentType !== 'DISBURSEMENT').reduce((s, t) => s + Math.abs(n(t.amount)), 0));
      out.bank.out90 = r2(transactions.filter((t) => t.paymentType === 'DISBURSEMENT').reduce((s, t) => s + Math.abs(n(t.amount)), 0));
    } else out.bank.trendError = transactions.error;
  } else out.bank = accounts;

  const names = await partyNames(token, [
    ...(ok(receivables) ? receivables.map((r) => r.customerId) : []),
    ...(ok(payables) ? payables.map((p) => p.supplierId) : []),
  ]);

  // ---------- Forderungen ----------
  if (ok(receivables)) {
    const open = receivables.filter((r) => r.paymentStatus !== 'PAID' && r.paymentStatus !== 'NO_OPEN_ITEM')
      .map((r) => ({ id: r.id, number: r.invoiceNumber, customer: names[r.customerId] || '', customerId: r.customerId, due: n(r.dueDate) || n(r.invoiceDate), amount: r2(n(r.grossAmount) * sign(r.salesInvoiceType)) }));
    const buckets = [['nicht fällig', -Infinity, 0], ['1–30 Tage', 1, 30], ['31–60 Tage', 31, 60], ['61–90 Tage', 61, 90], ['über 90 Tage', 91, Infinity]]
      .map(([label, from, to]) => {
        const rows = open.filter((r) => { const d = Math.floor((now - r.due) / D); return d >= from && d <= to; });
        return { label, count: rows.length, amount: r2(rows.reduce((s, r) => s + r.amount, 0)) };
      });
    const byCustomer = new Map();
    for (const r of open.filter((x) => x.due < now)) byCustomer.set(r.customer || r.customerId, r2((byCustomer.get(r.customer || r.customerId) || 0) + r.amount));
    out.receivables = {
      total: r2(open.reduce((s, r) => s + r.amount, 0)), count: open.length,
      overdue: r2(open.filter((r) => r.due < now).reduce((s, r) => s + r.amount, 0)),
      buckets,
      topDebtors: [...byCustomer].map(([customer, amount]) => ({ customer, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
      list: open.filter((r) => r.due < now).map((r) => ({ ...r, days: Math.floor((now - r.due) / D) })).sort((a, b) => b.days - a.days).slice(0, 15),
    };
  } else out.receivables = receivables;

  // ---------- Verbindlichkeiten ----------
  if (ok(payables)) {
    const open = payables.map((p) => ({ id: p.id, number: p.invoiceNumber || p.internalInvoiceNumber, supplier: names[p.supplierId] || '', due: n(p.dueDate) || n(p.invoiceDate), amount: r2(n(p.grossAmount) * sign(p.purchaseInvoiceType)), blocked: !!p.paymentBlock }));
    const within = (days) => r2(open.filter((p) => p.due >= now && p.due <= now + days * D).reduce((s, p) => s + p.amount, 0));
    out.payables = {
      total: r2(open.reduce((s, p) => s + p.amount, 0)), count: open.length,
      overdue: r2(open.filter((p) => p.due < now).reduce((s, p) => s + p.amount, 0)),
      due7: within(7), due30: within(30), blocked: open.filter((p) => p.blocked).length,
      list: open.sort((a, b) => a.due - b.due).slice(0, 15).map((p) => ({ ...p, days: Math.floor((p.due - now) / D) })),
    };
  } else out.payables = payables;

  // ---------- Umsatz und Kosten je Monat (laufendes Jahr vs. Vorjahr) ----------
  const monthly = (rows, field) => {
    const m = {};
    for (const r of rows) { const k = monthKey(n(r.invoiceDate)); m[k] = r2((m[k] || 0) + n(r[field]) * sign(r.salesInvoiceType || r.purchaseInvoiceType)); }
    return m;
  };
  const ytdCut = (y) => new Date(y, today.getMonth(), today.getDate(), 23, 59).getTime();
  const sumBetween = (rows, field, from, to) => r2(rows.filter((r) => n(r.invoiceDate) >= from && n(r.invoiceDate) <= to).reduce((s, r) => s + n(r[field]) * sign(r.salesInvoiceType || r.purchaseInvoiceType), 0));
  const months = Array.from({ length: 12 }, (_, i) => i);
  const series = (m) => months.map((i) => ({
    month: new Date(today.getFullYear(), i, 1).toLocaleDateString('de-AT', { month: 'short' }),
    current: m[`${today.getFullYear()}-${String(i + 1).padStart(2, '0')}`] || 0,
    previous: m[`${today.getFullYear() - 1}-${String(i + 1).padStart(2, '0')}`] || 0,
    future: i > today.getMonth(),
  }));
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime();
  if (ok(sales)) {
    out.revenue = {
      months: series(monthly(sales, 'netAmount')),
      ytd: sumBetween(sales, 'netAmount', yearStart, now),
      ytdPrev: sumBetween(sales, 'netAmount', lastYearStart, ytdCut(today.getFullYear() - 1)),
      month: sumBetween(sales, 'netAmount', monthStart, now),
      monthPrevYear: sumBetween(sales, 'netAmount', new Date(today.getFullYear() - 1, today.getMonth(), 1).getTime(), ytdCut(today.getFullYear() - 1)),
    };
  } else out.revenue = sales;
  if (ok(purchases)) {
    out.costs = {
      months: series(monthly(purchases, 'netAmount')),
      ytd: sumBetween(purchases, 'netAmount', yearStart, now),
      ytdPrev: sumBetween(purchases, 'netAmount', lastYearStart, ytdCut(today.getFullYear() - 1)),
      month: sumBetween(purchases, 'netAmount', monthStart, now),
    };
  } else out.costs = purchases;
  if (ok(out.revenue) && ok(out.costs)) {
    out.result = { ytd: r2(out.revenue.ytd - out.costs.ytd), ytdPrev: r2(out.revenue.ytdPrev - out.costs.ytdPrev) };
  }

  // ---------- USt-Zahllast (Näherung) ----------
  if (ok(sales) && ok(purchases)) {
    const vat = (from, to) => r2(sumBetween(sales, 'vatAmount', from, to) - sumBetween(purchases, 'vatAmount', from, to));
    out.vat = {
      month: vat(monthStart, now), monthLabel: today.toLocaleDateString('de-AT', { month: 'long' }),
      prevMonth: vat(prevMonthStart, monthStart - 1), prevMonthLabel: new Date(prevMonthStart).toLocaleDateString('de-AT', { month: 'long' }),
    };
  }

  // ---------- Wiederkehrender Umsatz ----------
  out.mrr = ok(contracts) ? { monthly: monthlyValue(contracts), count: contracts.length } : contracts;

  // ---------- Liquiditätsvorschau ----------
  if (ok(out.bank) && ok(out.receivables) && ok(out.payables)) {
    const recv = ok(receivables) ? out.receivables : null;
    const allOpen = ok(receivables) ? receivables : [];
    const pay = ok(payables) ? payables : [];
    const forecast = [30, 60, 90].map((days) => {
      const until = now + days * D;
      // eingehend: fällig bis dahin, aber nicht länger als 90 Tage überfällig (die sind unsicher)
      const inflow = r2(allOpen.filter((r) => { const due = n(r.dueDate) || n(r.invoiceDate); return due <= until && now - due <= 90 * D; }).reduce((s, r) => s + n(r.grossAmount) * sign(r.salesInvoiceType), 0));
      const outflow = r2(pay.filter((p) => (n(p.dueDate) || n(p.invoiceDate)) <= until).reduce((s, p) => s + n(p.grossAmount) * sign(p.purchaseInvoiceType), 0));
      return { days, inflow, outflow, balance: r2(out.bank.balance + inflow - outflow) };
    });
    out.forecast = forecast;
    void recv;
  }

  out.notes.push('Offene Rechnungen werden mit dem vollen Rechnungsbetrag gerechnet (Teilzahlungen führt weclapp nicht je Rechnung).');
  out.notes.push('USt-Zahllast ist eine Näherung aus Ausgangs- minus Eingangsrechnungen nach Rechnungsdatum – keine UVA.');
  out.notes.push('Liquiditätsvorschau: Kontostand + fällige Forderungen (max. 90 Tage überfällig) − fällige Eingangsrechnungen. Wiederkehrende Kosten ohne Rechnung (Gehälter, Miete) sind nicht enthalten.');
  return out;
}
