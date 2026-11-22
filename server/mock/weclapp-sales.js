// Vertriebsteil des weclapp-Mocks: Managed-Service-Artikel, Angebote,
// Aufträge, Rechnungen, Verträge. Feld- und Statusnamen wie in der weclapp-API v2.
const D = 864e5;
const now = Date.now();
const ago = (days) => now - days * D;

export function registerSales(r, { applyFilters, parties, tickets, timeRecords, documents, articles }) {
  const categories = [{ id: '900', name: 'Managed Services' }, { id: '901', name: 'Hardware' }];
  const units = [{ id: 'u1', name: 'Stk.' }, { id: 'u2', name: 'Arbeitsplatz' }, { id: 'u3', name: 'Server' }, { id: 'u4', name: 'Benutzer' }, { id: 'u5', name: 'Firewall' }, { id: 'u6', name: 'Pauschale' }, { id: 'u7', name: 'Gerät' }];
  // Realistische weclapp-Artikel: eigene Artikelnummern und Namen, NICHT die Board-Kennungen.
  // Die Verknüpfung passiert im Board unter "Artikelzuordnung" (Vorschläge über den Namen).
  // Bewusst: SLA-Pakete fehlen (neu), Firewall Premium hat einen abweichenden Preis.
  [
    ['10010', 'Next Security Ultimate MXDR', 25],
    ['10011', 'Next Security Professional', 19],
    ['10012', 'Next Security Node', 14],
    ['10020', 'Managed Client Premium', 18],
    ['10021', 'Managed Server Premium', 99],
    ['10030', 'Managed Firewall Essential (FortiGate)', 149],
    ['10031', 'Managed Firewall Business (FortiGate)', 249],
    ['10032', 'Managed Firewall Premium (FortiGate)', 459],
    ['10040', 'Client Flatrate Fernunterstützung', 19.9],
    ['10041', 'Server Flatrate Fernunterstützung', 49.9],
    ['10090', 'Projektleistung Sonderaufwand', 0],
    ['10050', 'SLA-Einrichtung und Dokumentation', 290],
  ].forEach(([articleNumber, name, price], i) => articles.push({
    id: String(800 + i), articleNumber, name, unitId: 'u1', articleType: 'SERVICE', active: true, articleCategoryId: '900',
    articlePrices: [{ price: String(price), currencyId: '1', salesChannel: 'NET1', priceScaleValue: '1', startDate: ago(400) }],
  }));
  const priceOf = (id) => Number(articles.find((a) => a.id === id)?.articlePrices?.[0]?.price || 100);

  // Angebote
  const quotations = [];
  const addQuotation = (partyId, days, status, items) => {
    const quotationItems = items.map(([articleId, quantity], i) => ({ id: `qi${quotations.length}-${i}`, articleId, quantity: String(quantity), unitPrice: String(priceOf(articleId)), positionNumber: i + 1 }));
    const net = quotationItems.reduce((s, it) => s + Number(it.unitPrice) * Number(it.quantity), 0);
    quotations.push({
      id: String(3000 + quotations.length), quotationNumber: String(24100 + quotations.length), customerId: partyId, status,
      quotationDate: ago(days), validTo: ago(days - 30), lastModifiedDate: ago(Math.max(days - 2, 0)), netAmount: net.toFixed(2), grossAmount: (net * 1.2).toFixed(2), quotationItems,
    });
  };
  addQuotation('504', 3, 'OPEN', [['800', 6], ['804', 1], ['807', 6]]);
  addQuotation('506', 9, 'ENTRY_COMPLETED', [['800', 12], ['801', 15], ['805', 1]]);
  addQuotation('511', 18, 'OPEN', [['800', 4], ['801', 6], ['809', 1]]);
  addQuotation('503', 26, 'ENTRY_COMPLETED', [['804', 2], ['806', 2], ['808', 2]]);
  addQuotation('509', 41, 'INQUIRED', [['800', 5], ['803', 6]]);
  addQuotation('507', 5, 'ACCEPTED', [['800', 8], ['801', 10]]);
  addQuotation('502', 12, 'ACCEPTED', [['802', 9], ['803', 9]]);
  addQuotation('505', 60, 'REJECTED', [['800', 6]]);

  // Aufträge der letzten Monate
  const salesOrders = [];
  const vols = [[160, 4200], [140, 2900], [120, 6100], [100, 3400], [80, 5200], [60, 2500], [45, 7400], [30, 3900], [20, 1800], [10, 4600], [4, 2200], [2, 980]];
  vols.forEach(([days, net], i) => salesOrders.push({
    id: String(4000 + i), orderNumber: String(31200 + i), customerId: parties[i % parties.length].id, orderDate: ago(days),
    netAmount: String(net), status: days < 25 ? 'ORDER_CONFIRMATION_PRINTED' : 'CLOSED', invoiced: days > 25, quotationId: null,
  }));

  // Rechnungen
  const salesInvoices = [
    ['501', 48, 34, 1290.00], ['503', 40, 26, 2380.80], ['506', 20, 6, 845.40], ['509', 16, 2, 419.00],
    ['502', 10, -4, 1734.00], ['507', 5, -9, 3120.00], ['510', 70, 56, 288.00],
  ].map(([customerId, invDays, overdueDays, gross], i) => ({
    id: String(5000 + i), invoiceNumber: String(41800 + i), customerId, invoiceDate: ago(invDays), dueDate: ago(overdueDays),
    grossAmount: gross.toFixed(2), netAmount: (gross / 1.2).toFixed(2), paid: false, paymentStatus: 'OPEN', status: 'OPEN_ITEM_CREATED',
  }));

  // ---------- Finanzdaten (Demo) ----------
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const today = new Date();
  const monthsBack = 22;
  // bezahlte Ausgangsrechnungen der letzten ~2 Jahre (Umsatz-Historie) + eine Gutschrift
  for (let m = monthsBack; m >= 0; m--) {
    const base = 14000 + (monthsBack - m) * 350;
    for (let k = 0; k < 6; k++) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 2 + k * 4);
      if (d.getTime() > now) continue;
      const net = Math.round((base / 6) * (0.6 + rnd() * 0.8) * 100) / 100;
      salesInvoices.push({ id: `h${m}-${k}`, invoiceNumber: String(40000 + m * 10 + k), customerId: parties[(m + k) % parties.length].id, invoiceDate: d.getTime(), dueDate: d.getTime() + 14 * D,
        netAmount: net.toFixed(2), vatAmount: (net * 0.2).toFixed(2), grossAmount: (net * 1.2).toFixed(2), paid: true, paymentStatus: 'PAID', status: 'OPEN_ITEM_CREATED', salesInvoiceType: 'STANDARD_INVOICE' });
    }
  }
  salesInvoices.push({ id: 'gs1', invoiceNumber: '49001', customerId: '503', invoiceDate: ago(20), dueDate: ago(6), netAmount: '250.00', vatAmount: '50.00', grossAmount: '300.00', paid: true, paymentStatus: 'PAID', status: 'OPEN_ITEM_CREATED', salesInvoiceType: 'CREDIT_NOTE' });
  for (const i of salesInvoices) { if (!i.vatAmount) i.vatAmount = (Number(i.grossAmount) - Number(i.netAmount)).toFixed(2); if (!i.salesInvoiceType) i.salesInvoiceType = 'STANDARD_INVOICE'; }

  const suppliers = [['601', 'Distributor IT-Handel GmbH'], ['602', 'Microsoft Ireland Operations'], ['603', 'A1 Telekom Austria AG'], ['604', 'Kaspersky Labs GmbH'], ['605', 'Büro & Miete Linz KG']];
  for (const [id, company] of suppliers) parties.push({ id, company, supplier: true, customer: false, partyType: 'ORGANIZATION', addresses: [] });
  const purchaseInvoices = [];
  for (let m = monthsBack; m >= 0; m--) {
    for (let k = 0; k < 4; k++) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 3 + k * 6);
      if (d.getTime() > now) continue;
      const net = Math.round((2400 + rnd() * 1800) * 100) / 100;
      purchaseInvoices.push({ id: `p${m}-${k}`, invoiceNumber: `ER-${m}${k}`, internalInvoiceNumber: String(70000 + m * 10 + k), supplierId: suppliers[(m + k) % suppliers.length][0], invoiceDate: d.getTime(), dueDate: d.getTime() + 21 * D,
        netAmount: net.toFixed(2), vatAmount: (net * 0.2).toFixed(2), grossAmount: (net * 1.2).toFixed(2), paymentStatus: m === 0 && k > 1 ? 'OPEN' : 'PAID', status: 'OPEN_ITEM_CREATED', purchaseInvoiceType: 'STANDARD_INVOICE', paymentBlock: false });
    }
  }
  [[-8, 1840.5, '601', false], [-2, 612.0, '603', false], [3, 4890.0, '602', false], [9, 1290.0, '604', true], [25, 2100.0, '605', false]].forEach(([inDays, gross, supplierId, block], i) => purchaseInvoices.push({
    id: `po${i}`, invoiceNumber: `ER-O${i}`, internalInvoiceNumber: String(79000 + i), supplierId, invoiceDate: now - 20 * D, dueDate: now + inDays * D,
    netAmount: (gross / 1.2).toFixed(2), vatAmount: (gross - gross / 1.2).toFixed(2), grossAmount: gross.toFixed(2), paymentStatus: 'OPEN', status: 'OPEN_ITEM_CREATED', purchaseInvoiceType: 'STANDARD_INVOICE', paymentBlock: block }));

  const bankAccounts = [
    { id: 'b1', creditInstitute: 'Raiffeisenbank Oberösterreich', accountHolder: 'Schwaiger BUSINESS IT GmbH', iban: 'AT611904300234573201', balance: '48230.55', currencyId: '1', lastDownload: now - 6 * 3600e3, connectionFailure: false, creditLine: '20000', primary: true, active: true, autoSync: true },
    { id: 'b2', creditInstitute: 'Erste Bank', accountHolder: 'Schwaiger BUSINESS IT GmbH', iban: 'AT022011100000012345', balance: '12450.10', currencyId: '1', lastDownload: now - 30 * 3600e3, connectionFailure: false, creditLine: '0', primary: false, active: true, autoSync: true },
  ];
  const bankTransactions = [];
  for (let i = 0; i < 90; i++) {
    if (rnd() < 0.55) bankTransactions.push({ id: `bt${i}a`, amount: (800 + rnd() * 5200).toFixed(2), effectiveDate: now - i * D, paymentType: 'RECEIPT' });
    if (rnd() < 0.5) bankTransactions.push({ id: `bt${i}b`, amount: (300 + rnd() * 3900).toFixed(2), effectiveDate: now - i * D, paymentType: 'DISBURSEMENT' });
    if (i % 30 === 27) bankTransactions.push({ id: `bt${i}g`, amount: '18400.00', effectiveDate: now - i * D, paymentType: 'DISBURSEMENT' }); // Gehälter
  }

  // Verträge (wiederkehrende Abrechnung)
  const contracts = [
    ['501', [['800', 3, 29], ['804', 1, 99]]], ['502', [['800', 8, 29], ['804', 2, 99], ['806', 2, 49]]],
    ['507', [['800', 4, 29], ['801', 10, 6]]], ['508', [['800', 3, 29], ['804', 1, 99], ['805', 1, 59]]],
    ['505', [['800', 5, 29]]], ['510', [['801', 3, 6]]],
  ].map(([partyId, items], i) => ({
    id: String(6000 + i), contractNumber: `V-${100 + i}`, partyId, contractStatus: 'ACTIVE',
    name: i === 5 ? 'Hosting Webseite' : 'Wartungsvertrag IT', types: [{ id: i === 5 ? 't3' : i % 2 ? 't2' : 't1' }],
    startDate: ago([900, 700, 150, 500, 400, 60][i]), unlimited: i !== 3, endDate: i === 3 ? ago(-200) : null,
    latestPossibleTerminationDate: i === 3 ? ago(-110) : null, billingType: 'IN_ADVANCE',
    contractItems: items.map(([articleId, q, p]) => ({ articleId, quantity: String(q), unitPrice: String(p), netAmount: String(q * p), interval: 'MONTHLY', intervalType: 'RECURRENT' })),
    contractCostItems: [],
  }));
  // Lang & Partner: Lizenzkosten direkt als Kostenpositionen im Vertrag gepflegt
  contracts[1].contractCostItems = [
    { id: 'cc1', title: 'Microsoft Defender (Distributor)', articleId: '800', quantity: '8', unitPrice: '12', netAmount: '96', interval: 'MONTHLY', intervalType: 'RECURRENT' },
    { id: 'cc2', title: 'FortiGate FortiCare/UTP', articleId: '806', quantity: '2', unitPrice: '98', netAmount: '196', interval: 'MONTHLY', intervalType: 'RECURRENT' },
  ];
  const contractTypes = [{ id: 't1', name: 'Wartungsvertrag', active: true }, { id: 't2', name: 'Managed Service', active: true }, { id: 't3', name: 'Hosting', active: true }];

  // Einkaufspreise (Bezugsquellen) für Lizenz-Artikel; Dienstleistungen haben keinen
  const supplySources = [['800', 11], ['801', 8.5], ['802', 6], ['805', 62], ['806', 98], ['807', 175]].map(([articleId, price], i) => {
    const a = articles.find((x) => x.id === articleId);
    a.supplySources = [{ id: `ss${i}`, articleSupplySourceId: `as${i}` }];
    a.primarySupplySourceId = `as${i}`;
    a.articleType = 'STORABLE';
    return { id: `as${i}`, articleId, supplierId: 's1', articlePrices: [{ price: String(price), priceScaleValue: '1', startDate: ago(500) }] };
  });

  // Zeitbuchungen je Kunde über das letzte Jahr (Lang & Partner bewusst sehr betreuungsintensiv)
  const hoursPerMonth = { 501: [2.5, 0.5], 502: [10, 1], 503: [3, 3], 505: [1.5, 0.25], 506: [4, 2.5], 507: [2, 1], 508: [3.5, 0.5], 509: [1, 1], 510: [0.25, 0] };
  for (const [partyId, [h, billable]] of Object.entries(hoursPerMonth)) {
    for (let m = 0; m < 12; m++) {
      const dur = Math.round(h * (0.7 + rnd() * 0.6) * 3600);
      const bill = Math.min(dur, Math.round(billable * 3600));
      timeRecords.push({ id: `tm${partyId}-${m}`, userId: '101', customerId: partyId, startDate: ago(m * 30 + 5), durationSeconds: dur, billableDurationSeconds: bill, billable: bill > 0, description: 'Betreuung' });
    }
  }

  const list = (rows) => (req, res) => {
    let out = applyFilters(rows, req.query);
    if (req.query.sort) {
      const desc = req.query.sort.startsWith('-');
      const k = req.query.sort.replace(/^-/, '');
      out = [...out].sort((a, b) => (Number(a[k]) - Number(b[k]) || String(a[k]).localeCompare(String(b[k]))) * (desc ? -1 : 1));
    }
    res.json({ result: out.slice(0, Number(req.query.pageSize) || 100) });
  };

  r.get('/articleCategory', list(categories));
  // Ticket-Stammdaten und Anlegen (Pflichtfelder wie in weclapp)
  r.get('/ticketPriority', list([{ id: 'p1', name: 'Niedrig', positionNumber: 1 }, { id: 'p2', name: 'Normal', positionNumber: 2 }, { id: 'p3', name: 'Hoch', positionNumber: 3 }, { id: 'p4', name: 'Kritisch', positionNumber: 4 }]));
  r.get('/ticketChannel', list([{ id: 'c1', name: 'Telefon', positionNumber: 1 }, { id: 'c2', name: 'E-Mail', positionNumber: 2 }, { id: 'c3', name: 'Monitoring', positionNumber: 3 }]));
  r.post('/ticket', (req, res) => {
    const b = req.body || {};
    const missing = ['partyId', 'subject', 'ticketStatusId', 'ticketPriorityId', 'ticketChannelId'].filter((k) => !b[k]);
    if (missing.length) return res.status(400).json({ title: 'validation failed', messages: missing.map((k) => ({ location: k, message: 'required' })) });
    const t = { id: String(9000 + tickets.length), ticketNumber: `T-${10231 + tickets.length}`, ...b, assignedUserId: b.assignedUserId || null, lastModifiedDate: Date.now() };
    tickets.push(t);
    console.log('[mock] Ticket angelegt:', t.ticketNumber, t.subject, 'Prio', t.ticketPriorityId, 'Mail aus:', t.disableEmailTemplates);
    res.status(201).json(t);
  });
  r.get('/article/id/:id', (req, res) => {
    const a = articles.find((x) => x.id === req.params.id);
    a ? res.json(a) : res.status(404).json({ title: 'Not Found' });
  });
  r.get('/unit', list(units));
  r.get('/quotation', list(quotations));
  r.get('/quotation/count', (req, res) => res.json({ result: applyFilters(quotations, req.query).length }));
  r.get('/salesOrder', list(salesOrders));
  r.get('/salesInvoice', list(salesInvoices));
  r.get('/contract', list(contracts));
  r.get('/contractType', list(contractTypes));
  r.get('/articleSupplySource', list(supplySources));
  r.get('/purchaseInvoice', list(purchaseInvoices));
  r.get('/bankAccount', list(bankAccounts));
  r.get('/bankTransaction', list(bankTransactions));
  r.get('/ticket/count', (req, res) => res.json({ result: applyFilters(tickets, req.query).length }));
  r.get('/party/id/:id', (req, res) => {
    const p = parties.find((x) => x.id === req.params.id);
    p ? res.json(p) : res.status(404).json({ title: 'Not Found' });
  });

  r.post('/party', (req, res) => {
    const b = req.body || {};
    if (!b.company) return res.status(400).json({ title: 'validation failed', messages: [{ location: 'company', message: 'company required' }] });
    const p = { id: String(600 + parties.length), customerNumber: `K-${10100 + parties.length}`, ...b, addresses: [] };
    parties.push(p);
    console.log('[mock] Neukunde angelegt:', p.customerNumber, p.company);
    res.status(201).json(p);
  });
  r.post('/quotation', (req, res) => {
    const b = req.body || {};
    if (!parties.some((p) => p.id === String(b.customerId))) return res.status(400).json({ title: 'validation failed', messages: [{ location: 'customerId', message: 'customer not found' }] });
    if (!Array.isArray(b.quotationItems) || !b.quotationItems.length) return res.status(400).json({ title: 'validation failed', messages: [{ message: 'quotationItems required' }] });
    for (const it of b.quotationItems) {
      if (!articles.some((a) => a.id === String(it.articleId))) return res.status(400).json({ title: 'validation failed', messages: [{ location: 'articleId', message: 'article not found' }] });
      if (it.manualUnitPrice !== undefined && typeof it.manualUnitPrice !== 'boolean') return res.status(400).json({ title: 'validation failed', messages: [{ location: 'manualUnitPrice', message: 'must be boolean' }] });
    }
    const net = b.quotationItems.reduce((s, it) => s + Number(it.unitPrice) * Number(it.quantity) * (1 - Number(it.discountPercentage || 0) / 100), 0);
    const q = { ...b, id: String(3000 + quotations.length), quotationNumber: String(24100 + quotations.length), status: 'OPEN', netAmount: net.toFixed(2), grossAmount: (net * 1.2).toFixed(2), lastModifiedDate: Date.now() };
    quotations.push(q);
    console.log('[mock] Angebot angelegt:', q.quotationNumber, q.netAmount);
    res.status(201).json(q);
  });
  r.post('/quotation/id/:id/accept', (req, res) => {
    const q = quotations.find((x) => x.id === req.params.id);
    if (!q) return res.status(404).json({ title: 'Not Found' });
    q.status = 'ACCEPTED';
    if (req.body?.quotationType === 'SALES_ORDER') {
      salesOrders.push({ id: String(4000 + salesOrders.length), orderNumber: String(31200 + salesOrders.length), customerId: q.customerId, orderDate: Date.now(), netAmount: q.netAmount, status: 'ORDER_ENTRY_IN_PROGRESS', invoiced: false, quotationId: q.id });
      console.log('[mock] Auftrag aus Angebot', q.quotationNumber);
    }
    res.json({ result: q });
  });
  r.post('/quotation/id/:id/updateStatus', (req, res) => {
    const q = quotations.find((x) => x.id === req.params.id);
    if (!q) return res.status(404).json({ title: 'Not Found' });
    q.status = req.body?.status || q.status;
    res.json({ result: q });
  });
  void documents;
}
