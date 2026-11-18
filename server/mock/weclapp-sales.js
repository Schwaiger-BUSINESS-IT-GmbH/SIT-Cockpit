// Vertriebsteil des weclapp-Mocks: Managed-Service-Artikel, Angebote,
// Aufträge, Rechnungen, Verträge. Feld- und Statusnamen wie in der weclapp-API v2.
const D = 864e5;
const now = Date.now();
const ago = (days) => now - days * D;

export function registerSales(r, { applyFilters, parties, tickets, documents, articles }) {
  const categories = [{ id: '900', name: 'Managed Services' }, { id: '901', name: 'Hardware' }];
  const units = [{ id: 'u1', name: 'Stk.' }, { id: 'u2', name: 'Arbeitsplatz' }, { id: 'u3', name: 'Server' }, { id: 'u4', name: 'Benutzer' }, { id: 'u5', name: 'Firewall' }, { id: 'u6', name: 'Pauschale' }, { id: 'u7', name: 'Gerät' }];
  const ms = [
    ['MS-WS', 'Managed Workplace', 'u2', 29, 'Monitoring, Patch-Management, Virenschutz und Remote-Support für einen Arbeitsplatz.'],
    ['MS-M365', 'Microsoft 365 Betreuung', 'u4', 6, 'Benutzerverwaltung, Lizenzen, Exchange- und Teams-Support.'],
    ['MS-SEC-MAIL', 'E-Mail-Schutz & Awareness', 'u4', 4.5, 'Spam- und Phishing-Filter, Security-Awareness-Training.'],
    ['MS-EDR', 'Managed EDR', 'u7', 7.9, 'Erkennung und Reaktion auf Angriffe, 24/7 überwacht.'],
    ['MS-SRV', 'Managed Server', 'u3', 99, 'Überwachung, Updates, Wartungsfenster und Störungsbehebung.'],
    ['MS-FW', 'Managed Firewall', 'u5', 59, 'Firmware-Updates, Regelwerk-Pflege, VPN-Betreuung.'],
    ['MS-BACKUP', 'Managed Backup (Cloud)', 'u3', 49, 'Tägliche Sicherung in ein österreichisches Rechenzentrum, Rücksicherungstests.'],
    ['MS-SETUP-WS', 'Einrichtung Arbeitsplatz', 'u2', 49, 'Agent-Installation, Grundkonfiguration, Dokumentation.'],
    ['MS-SETUP-SRV', 'Einrichtung Server', 'u3', 249, 'Übernahme in die Betreuung, Monitoring-Regeln, Backup-Einrichtung.'],
    ['MS-ONBOARD', 'Onboarding & IT-Dokumentation', 'u6', 390, 'Bestandsaufnahme, Passwort-Tresor, Netzwerkplan.'],
  ];
  ms.forEach(([articleNumber, name, unitId, price, description], i) => articles.push({
    id: String(800 + i), articleNumber, name, unitId, description, articleType: 'SERVICE', active: true, articleCategoryId: '900',
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

  // Verträge (wiederkehrende Abrechnung)
  const contracts = [
    ['501', [['800', 3, 29], ['804', 1, 99]]], ['502', [['800', 8, 29], ['804', 2, 99], ['806', 2, 49]]],
    ['507', [['800', 4, 29], ['801', 10, 6]]], ['508', [['800', 3, 29], ['804', 1, 99], ['805', 1, 59]]],
    ['505', [['800', 5, 29]]], ['510', [['801', 3, 6]]],
  ].map(([partyId, items], i) => ({
    id: String(6000 + i), contractNumber: `V-${100 + i}`, partyId, contractStatus: 'ACTIVE',
    contractItems: items.map(([articleId, q, p]) => ({ articleId, quantity: String(q), unitPrice: String(p), netAmount: String(q * p), interval: 'MONTHLY', intervalType: 'RECURRENT' })),
  }));

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
  r.get('/unit', list(units));
  r.get('/quotation', list(quotations));
  r.get('/quotation/count', (req, res) => res.json({ result: applyFilters(quotations, req.query).length }));
  r.get('/salesOrder', list(salesOrders));
  r.get('/salesInvoice', list(salesInvoices));
  r.get('/contract', list(contracts));
  r.get('/ticket/count', (req, res) => res.json({ result: applyFilters(tickets, req.query).length }));
  r.get('/party/id/:id', (req, res) => {
    const p = parties.find((x) => x.id === req.params.id);
    p ? res.json(p) : res.status(404).json({ title: 'Not Found' });
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
