// Angebotsboard im Stil von SIT_Angebotsboard_V4 – mit weclapp-Kunden, Entwürfen
// am Server, Unterschrift am Tablet und Onboarding-Checkliste je Auftrag.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0);
const money = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0);
const STEPS = ['Kundendaten', 'Interne Einstufung', 'Serviceauswahl', 'Angebot', 'Unterschrift', 'Onboarding'];
const RATINGS = [['margin', 'Wirtschaftlichkeit'], ['support', 'Aufwandseffizienz'], ['loyalty', 'Kundenbindung'], ['strategy', 'Strategischer Wert'], ['cooperation', 'Zusammenarbeit']];

let ctx; // { api, toast, me }
let cat = null; // Katalog vom Server
let root; // Container
let step = 0;
let kv = false; // Kundenansicht
let view = 'board'; // board | drafts | articles
let catStale = false;
let st = null; // Zustand des Angebots
let result = null; // unterschriebener Vorgang
let serverWarnings = [];
let pad = null;
let custSearchTimer, warnTimer;

// ---------- Sprache (alles, was der Kunde sieht; Internes bleibt deutsch) ----------
const UI = {
  de: {
    steps: ['Kundendaten', 'Interne Einstufung', 'Serviceauswahl', 'Angebot', 'Unterschrift', 'Onboarding'],
    internalApp: 'INTERNE ANWENDUNG', customerView: 'KUNDENANSICHT', toCustomer: 'Zur Kundenansicht', endCustomer: 'Kundenansicht beenden',
    heroEyebrow: 'KUNDEN-ONBOARDING', heroTitle: 'Ihre IT. <span>Unser Plan.</span>', heroText: 'Vom ersten Gespräch bis zum kalkulierten Managed-Service-Angebot. Klar, nachvollziehbar und auf Ihren Betrieb abgestimmt.', heroNoteB: 'Erst wofür. Dann womit.', heroNote: 'Beratung · Umsetzung · Betreuung',
    mCustomer: 'Kunde', newCustomer: 'Neukunde', users: (n) => `${n} Benutzer`, mSla: 'Service-Level', mSlaSub: 'Separat kalkuliert', mMonthly: 'Monatlich netto', mMonthlySub: 'Inkl. Managed Services', mOnboard: 'Onboarding', mOnboardDone: 'Abgeschlossene Schritte', mOnboardAfter: 'Nach Unterschrift',
    back: '← Zurück', next: 'Weiter →', stepOf: (a, b) => `Schritt ${a} von ${b}`,
    s1Eyebrow: '01 · Erstaufnahme', s1Title: 'Wofür braucht Ihr Betrieb IT?', s1Lead: 'Wir beginnen beim Unternehmen, nicht beim Produkt. Danach entsteht aus Anzahl, Bedarf und Betreuung eine nachvollziehbare Kalkulation.',
    yourCompany: 'Ihr Unternehmen', company: 'Unternehmen', contact: 'Ansprechpartner', mail: 'E-Mail', phone: 'Telefon', place: 'Ort / Hauptstandort', placePh: 'Österreich', namePh: 'Vorname Nachname',
    itEnv: 'IT-Umgebung', aUsers: 'Benutzer', aClients: 'Clients / PCs', aServers: 'Server', aFw: 'FortiGate-Firewalls', aSites: 'Standorte',
    itHint: 'Die Benutzeranzahl steuert den SLA-Zuschlag. Die Mengen für Managed Services werden separat gewählt und können vom Inventar abweichen.',
    goals: 'Ziele, Probleme und bestehende Betreuung', goalsPh: 'Was funktioniert gut? Was soll verbessert werden? Bestehende Verträge, Migrationsbedarf …',
    s3Eyebrow: '03 · Serviceauswahl', s3Title: 'Erst wofür. Dann womit.', s3Lead: 'Wählen Sie die benötigten Managed Services. Staffelpreise werden automatisch berücksichtigt. Alle Beträge netto und monatlich, sofern nicht anders gekennzeichnet.',
    slaHead: 'Service-Level – bei Bedarf zusätzlich', perUser: (v) => `+ ${v} je Benutzer / Monat`, p1: (v) => `P1-Reaktion: ${v}`,
    noSla: 'Kein zusätzliches SLA', noSlaSub: 'Es gelten ausschließlich bereits wirksam vereinbarte produktspezifische Bedingungen oder individuelle Vereinbarungen.',
    review: 'Zusätzliches IT-Review', reviewNone: 'Keines', reviewAnnual: (v) => `Jährlich +${v}/Monat`, reviewQuarter: (v) => `Quartalsweise +${v}/Monat`,
    setupCheck: (v) => `Einmalige SLA-Einrichtung – ${v}`, setupSub: 'Wird nur bei Auswahl eines zusätzlichen SLAs verrechnet.',
    compare: 'Reaktionszeiten aller SLA-Pakete vergleichen', prio: 'Priorität', prios: ['P1 – kritisch', 'P2 – hoch', 'P3 – normal', 'P4 – niedrig'], compareNote: 'Qualifizierte Erstreaktion während vertraglich vereinbarter Supportzeiten, keine garantierte Problemlösung.',
    catalog: 'Managed-Service-Katalog', suggestQty: 'Bestandsmengen vorschlagen', articles: (n) => `${n} Artikel`,
    perUnit: (u) => `je ${u}`, netPer: (u) => `netto / ${u} / Monat`, tierActive: 'Staffelpreis aktiv', tierFrom: (n, v) => `ab ${n} Stück: ${v}`, less: 'weniger', more: 'mehr', qtyOf: 'Anzahl', select: 'auswählen',
    details: 'Leistungsumfang und Abgrenzung', scope: 'Leistungsumfang', excl: 'Nicht enthalten / Voraussetzungen',
    project: 'Einmaliges Projekt / Sondereinrichtung', projectCheck: 'Zusätzliche Projektposition aufnehmen', projectName: 'Projektbezeichnung', projectPh: 'z. B. Microsoft-365-Migration', projectPrice: 'Einmaliger Preis netto',
    s4Eyebrow: '04 · Angebotsvorschau', s4Title: 'Ein Angebot, das Vertrauen schafft.', s4Lead: 'Nur kundenfähige Informationen erscheinen im Angebot.',
    showDetails: 'Leistungsbeschreibungen im Angebot anzeigen', showDetailsSub: 'Je nach Umfang kann das PDF dadurch mehrere Seiten enthalten.',
    draftPill: 'Angebotsentwurf', docTitle: 'IT-Betreuung und Managed Services', for: 'Für:', assetsLine: (a) => `${a.users} Benutzer · ${a.clients} Clients · ${a.servers} Server · ${a.firewalls} FortiGate · ${a.sites} ${a.sites === 1 ? 'Standort' : 'Standorte'}`,
    monthlyHead: 'Monatlich wiederkehrende Dienstleistungen', onceHead: 'Einmalige Dienstleistungen', none: 'Keine Positionen gewählt.', thService: 'Leistung', thQty: 'Menge', thPrice: 'Einzelpreis', thSum: 'Summe',
    monthlyNet: 'Monatlicher Nettobetrag', onceNet: 'Einmaliger Nettobetrag', firstNet: 'Erster Abrechnungsmonat netto', vat: (p) => `${p} % USt. (Standardfall Inland)`, firstGross: 'Erster Abrechnungsmonat brutto', arr: 'Wiederkehrender Jahreswert netto',
    notesHead: 'Leistungs- und Vertragsabgrenzung', extra: 'Zusatzanmerkungen:', notes: 'Anmerkungen zum Angebot', notesPh: 'Optionale Hinweise, z. B. Leistungsbeginn …',
    pdf: 'PDF-Vorschau', toSign: 'Weiter zur Unterschrift →',
    s5Eyebrow: '05 · Beauftragung', s5Title: 'Unterschreiben und loslegen.', s5Lead: 'Mit der Unterschrift wird das Angebot angenommen und als Auftrag übernommen. Sie erhalten das unterschriebene PDF.',
    signer: 'Name der unterschreibenden Person *', role: 'Funktion', rolePh: 'z. B. Geschäftsführung', copyMail: 'E-Mail für die Auftragskopie', signature: 'Unterschrift *', signHint: 'Hier mit dem Finger oder Stift unterschreiben', clearSign: 'Unterschrift löschen',
    accept: 'Ich beauftrage die angeführten Leistungen zu den genannten Konditionen.', terms: (url, firm) => `Es gelten die <a href="${url}" target="_blank" rel="noopener">AGB von ${firm}</a>.`, signBtn: 'Verbindlich beauftragen', sending: 'Wird übertragen …',
    errName: 'Name der unterschreibenden Person fehlt', errSig: 'Unterschrift fehlt', errAccept: 'Bitte die Beauftragung bestätigen', errReady: 'Offene Prüfpunkte: im Schritt „Angebot“ intern freigeben',
    done: 'Auftrag erteilt', signedBy: (c, n, d) => `${c} · unterschrieben von ${n} am ${d}`, monthlyNetShort: 'monatlich netto', onceShort: 'einmalig', openPdf: 'PDF öffnen', mailBtn: 'E-Mail an Kunden', toOnboard: 'Weiter zum Onboarding →', retry: 'Erneut an weclapp senden',
    mailSubject: (n) => `Ihr Auftrag IT-Betreuung und Managed Services${n ? ` Nr. ${n}` : ''}`,
    mailBody: (name, m, o, me, firm) => `Guten Tag ${name},\n\nvielen Dank für Ihren Auftrag. Im Anhang finden Sie die unterschriebene Auftragsübersicht.\n\nMonatlich: ${m} netto\nEinmalig: ${o} netto\n\nMit freundlichen Grüßen\n${me}\n${firm}`,
    sideTitle: 'Ihre Kalkulation', sideHead: 'Planbare IT-Kosten.', sideMonthlySub: 'Wiederkehrender Vertragswert', sideArr: 'Jahreswert netto', sideArrSub: '12 Monate ohne einmalige Leistungen', sideOnce: 'Einmalig', sideFirstNet: 'Erster Monat netto', sideFirstGross: 'Erster Monat brutto',
    config: 'Konfiguration', products: 'Gewählte Produkte', viewOffer: 'Angebot ansehen', once: 'Einmalig',
  },
  en: {
    steps: ['Company details', 'Internal rating', 'Services', 'Offer', 'Signature', 'Onboarding'],
    internalApp: 'INTERNAL VIEW', customerView: 'CUSTOMER VIEW', toCustomer: 'Customer view', endCustomer: 'End customer view',
    heroEyebrow: 'CUSTOMER ONBOARDING', heroTitle: 'Your IT. <span>Our plan.</span>', heroText: 'From the first conversation to a calculated managed services offer. Clear, transparent and tailored to your business.', heroNoteB: 'First why. Then how.', heroNote: 'Consulting · Implementation · Support',
    mCustomer: 'Customer', newCustomer: 'New customer', users: (n) => `${n} ${n === 1 ? 'user' : 'users'}`, mSla: 'Service level', mSlaSub: 'Calculated separately', mMonthly: 'Monthly net', mMonthlySub: 'Incl. managed services', mOnboard: 'Onboarding', mOnboardDone: 'Steps completed', mOnboardAfter: 'After signature',
    back: '← Back', next: 'Next →', stepOf: (a, b) => `Step ${a} of ${b}`,
    s1Eyebrow: '01 · Initial assessment', s1Title: 'What does your business need IT for?', s1Lead: 'We start with your company, not with the product. Based on size, needs and support, we then create a transparent calculation.',
    yourCompany: 'Your company', company: 'Company', contact: 'Contact person', mail: 'E-mail', phone: 'Phone', place: 'City / main site', placePh: 'Austria', namePh: 'First name Last name',
    itEnv: 'IT environment', aUsers: 'Users', aClients: 'Clients / PCs', aServers: 'Servers', aFw: 'FortiGate firewalls', aSites: 'Sites',
    itHint: 'The number of users determines the SLA surcharge. Quantities for managed services are selected separately and may differ from the inventory.',
    goals: 'Goals, issues and current support', goalsPh: 'What works well? What should be improved? Existing contracts, migration needs …',
    s3Eyebrow: '03 · Service selection', s3Title: 'First why. Then how.', s3Lead: 'Select the managed services you need. Volume prices are applied automatically. All amounts are net and monthly unless stated otherwise.',
    slaHead: 'Service level – optional add-on', perUser: (v) => `+ ${v} per user / month`, p1: (v) => `P1 response: ${v}`,
    noSla: 'No additional SLA', noSlaSub: 'Only product-specific terms already agreed or individual agreements apply.',
    review: 'Additional IT review', reviewNone: 'None', reviewAnnual: (v) => `Annual +${v}/month`, reviewQuarter: (v) => `Quarterly +${v}/month`,
    setupCheck: (v) => `One-time SLA setup – ${v}`, setupSub: 'Only charged if an additional SLA is selected.',
    compare: 'Compare response times of all SLA packages', prio: 'Priority', prios: ['P1 – critical', 'P2 – high', 'P3 – normal', 'P4 – low'], compareNote: 'Qualified first response during contractually agreed support hours, not a guaranteed resolution.',
    catalog: 'Managed services catalogue', suggestQty: 'Suggest quantities from inventory', articles: (n) => `${n} items`,
    perUnit: (u) => `per ${u}`, netPer: (u) => `net / ${u} / month`, tierActive: 'Volume price applied', tierFrom: (n, v) => `from ${n} units: ${v}`, less: 'less', more: 'more', qtyOf: 'Quantity', select: 'select',
    details: 'Scope of service and limitations', scope: 'Scope of service', excl: 'Not included / prerequisites',
    project: 'One-time project / special setup', projectCheck: 'Add a project item', projectName: 'Project name', projectPh: 'e.g. Microsoft 365 migration', projectPrice: 'One-time price net',
    s4Eyebrow: '04 · Offer preview', s4Title: 'An offer you can trust.', s4Lead: 'Only customer-relevant information appears in the offer.',
    showDetails: 'Show service descriptions in the offer', showDetailsSub: 'Depending on the scope, the PDF may have several pages.',
    draftPill: 'Offer draft', docTitle: 'IT Support and Managed Services', for: 'For:', assetsLine: (a) => `${a.users} ${a.users === 1 ? 'user' : 'users'} · ${a.clients} ${a.clients === 1 ? 'client' : 'clients'} · ${a.servers} ${a.servers === 1 ? 'server' : 'servers'} · ${a.firewalls} FortiGate · ${a.sites} ${a.sites === 1 ? 'site' : 'sites'}`,
    monthlyHead: 'Monthly recurring services', onceHead: 'One-time services', none: 'No items selected.', thService: 'Service', thQty: 'Qty', thPrice: 'Unit price', thSum: 'Total',
    monthlyNet: 'Monthly net amount', onceNet: 'One-time net amount', firstNet: 'First billing month net', vat: (p) => `${p} % VAT (domestic standard rate)`, firstGross: 'First billing month gross', arr: 'Recurring annual value net',
    notesHead: 'Scope of services and contractual limitations', extra: 'Additional notes:', notes: 'Notes on the offer', notesPh: 'Optional notes, e.g. start of service …',
    pdf: 'PDF preview', toSign: 'Continue to signature →',
    s5Eyebrow: '05 · Order', s5Title: 'Sign and get started.', s5Lead: 'With your signature the offer is accepted and placed as an order. You will receive the signed PDF.',
    signer: 'Name of signatory *', role: 'Position', rolePh: 'e.g. Managing Director', copyMail: 'E-mail for the order copy', signature: 'Signature *', signHint: 'Sign here with your finger or a stylus', clearSign: 'Clear signature',
    accept: 'I hereby order the listed services at the stated conditions.', terms: (url, firm) => `The <a href="${url}" target="_blank" rel="noopener">general terms and conditions of ${firm}</a> apply.`, signBtn: 'Place binding order', sending: 'Submitting …',
    errName: 'Name of signatory is missing', errSig: 'Signature is missing', errAccept: 'Please confirm the order', errReady: 'Open review items: internal approval required in step “Offer”',
    done: 'Order placed', signedBy: (c, n, d) => `${c} · signed by ${n} on ${d}`, monthlyNetShort: 'monthly net', onceShort: 'one-time', openPdf: 'Open PDF', mailBtn: 'E-mail to customer', toOnboard: 'Continue to onboarding →', retry: 'Send to weclapp again',
    mailSubject: (n) => `Your order: IT support and managed services${n ? ` no. ${n}` : ''}`,
    mailBody: (name, m, o, me, firm) => `Dear ${name},\n\nthank you for your order. Please find the signed order summary attached.\n\nMonthly: ${m} net\nOne-time: ${o} net\n\nKind regards\n${me}\n${firm}`,
    sideTitle: 'Your calculation', sideHead: 'Predictable IT costs.', sideMonthlySub: 'Recurring contract value', sideArr: 'Annual value net', sideArrSub: '12 months excluding one-time services', sideOnce: 'One-time', sideFirstNet: 'First month net', sideFirstGross: 'First month gross',
    config: 'Configuration', products: 'Selected products', viewOffer: 'View offer', once: 'One-time',
  },
};
const lang = () => (st?.lang === 'en' ? 'en' : 'de');
const tr = (k, ...a) => { const v = UI[lang()][k] ?? UI.de[k]; return typeof v === 'function' ? v(...a) : v; };
const LOC = () => (lang() === 'en' ? 'en-GB' : 'de-AT');
const amt = (n) => new Intl.NumberFormat(LOC(), { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const catCache = {};
async function loadCatalog(l) {
  if (!catCache[l]) catCache[l] = await ctx.api('/offer/catalog?lang=' + l);
  cat = catCache[l];
}

const fresh = () => ({
  lang: st?.lang || 'de',
  draftId: null,
  customer: { id: null, number: '', company: '', contact: '', mail: '', phone: '', place: '' },
  assets: { users: 10, clients: 10, servers: 1, firewalls: 1, sites: 1 },
  intakeNotes: '',
  internal: { category: 'Silber', ratings: { margin: 3, support: 3, loyalty: 4, strategy: 3, cooperation: 4 }, reason: '' },
  sla: 'none', review: 'none', setup: true,
  products: (cat?.products || []).map((p) => ({ id: p.id, selected: false, qty: 0, custom: '' })),
  project: { enabled: false, name: '', price: 0 },
  notes: '', includeDetails: true, ready: false,
  signer: { name: '', role: '', email: '' }, accepted: false,
});

/** Vom Kundendetail aus: weclapp-Kunden vorbelegen */
export function prefillCustomer(party) {
  pending = party;
}
let pending = null;

export async function renderBoard(container, context) {
  ctx = context;
  root = container;
  if (!cat) {
    root.innerHTML = '<p class="loading" style="padding:28px">Lade Angebotsboard …</p>';
    try { await loadCatalog(st?.lang || 'de'); } catch (e) {
      root.innerHTML = `<div class="banner crit" style="margin:28px"><div><b>Angebotsboard konnte nicht geladen werden</b>${esc(e.message)}</div></div>`;
      return;
    }
  }
  if (!st) st = fresh();
  if (pending) {
    st = fresh();
    result = null;
    step = 0;
    await pickCustomer(pending.id).catch(() => { st.customer = { ...st.customer, id: pending.id, company: pending.name, number: pending.number || '' }; });
    pending = null;
  }
  render();
}
export function leaveBoard() {
  document.body.classList.remove('kv');
}

// ---------- Berechnung (Anzeige; verbindlich rechnet der Server) ----------
function itemData() {
  const monthly = [], once = [];
  const T = cat.texts || {}, U = (u) => T.units?.[u] || u;
  const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  if (st.sla !== 'none') {
    const r = cat.sla.rates[st.sla], label = cat.sla.labels[st.sla];
    monthly.push({ name: fill(T.slaBase, { label }), qty: 1, unit: U('Monat'), price: r.base, desc: fill(T.slaBaseDesc, r) });
    if (count(st.assets.users)) monthly.push({ name: fill(T.slaUser, { label }), qty: count(st.assets.users), unit: U('User'), price: r.user, desc: T.slaUserDesc });
    if (count(st.assets.sites) > 1) monthly.push({ name: T.site, qty: count(st.assets.sites) - 1, unit: U('Standort'), price: cat.sla.site, desc: T.siteDesc });
    const rv = cat.sla.reviewTexts?.[st.review];
    if (rv) monthly.push({ name: rv.name, qty: 1, unit: U('Monat'), price: cat.sla.reviews[st.review], desc: rv.desc });
    if (st.setup) once.push({ name: T.setup, qty: 1, unit: U('einmalig'), price: cat.sla.setup, desc: T.setupDesc });
  }
  for (const p of cat.products) {
    const s = st.products.find((x) => x.id === p.id);
    if (!s?.selected || !count(s.qty)) continue;
    const price = p.threshold && count(s.qty) >= p.threshold ? p.tier : p.price;
    monthly.push({ name: p.name, qty: count(s.qty), unit: p.unit, price, desc: s.custom.trim() || `${p.scope}\n\n${T.exclusionsLabel}:\n${p.exclusions}` });
  }
  if (st.project.enabled && st.project.name.trim()) once.push({ name: st.project.name, qty: 1, unit: U('einmalig'), price: money(st.project.price), desc: T.projectDesc });
  return { monthly, once };
}
function totals() {
  const d = itemData();
  const monthly = d.monthly.reduce((a, p) => a + p.price * p.qty, 0), once = d.once.reduce((a, p) => a + p.price * p.qty, 0);
  const vat = cat.vatPercent / 100;
  return { monthly, once, arr: monthly * 12, first: monthly + once, vat: (monthly + once) * vat, gross: (monthly + once) * (1 + vat) };
}
function refreshWarnings() {
  clearTimeout(warnTimer);
  warnTimer = setTimeout(async () => {
    try {
      const r = await ctx.api('/offer/calculate', { method: 'POST', body: payload() });
      serverWarnings = r.warnings;
      const box = root.querySelector('#warnbox');
      if (box) box.outerHTML = warnBox();
    } catch { /* Anzeige bleibt */ }
  }, 250);
}
const payload = () => ({ ...st, products: st.products.map(({ id, selected, qty, custom }) => ({ id, selected, qty, custom })) });

// ---------- Bausteine ----------
const field = (label, path, val, type = 'text', ph = '', extra = '') => `<div class="field"><label for="f-${path.replace(/\W/g, '-')}">${esc(label)}</label><input id="f-${path.replace(/\W/g, '-')}" data-path="${path}" type="${type}" ${type === 'number' ? 'min="0" step="1" inputmode="numeric"' : ''} value="${esc(val)}" placeholder="${esc(ph)}" ${extra}></div>`;
const area = (label, path, val, ph = '') => `<div class="field"><label for="f-${path.replace(/\W/g, '-')}">${esc(label)}</label><textarea id="f-${path.replace(/\W/g, '-')}" data-path="${path}" placeholder="${esc(ph)}">${esc(val)}</textarea></div>`;
const check = (path, checked, title, desc = '') => `<label class="checkline"><input type="checkbox" data-path="${path}" ${checked ? 'checked' : ''}><span><strong>${title}</strong>${desc ? `<small>${desc}</small>` : ''}</span></label>`;
const warnBox = () => (serverWarnings.length
  ? `<div id="warnbox" class="hint warning internal-only"><strong>Prüfpunkte vor Freigabe (intern):</strong><ul>${serverWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
  : '<div id="warnbox"></div>');

// ---------- Schritte ----------
function customerStep() {
  const c = st.customer;
  return `<span class="eyebrow">${tr('s1Eyebrow')}</span><h2>${tr('s1Title')}</h2><p class="lead">${tr('s1Lead')}</p>
  <section class="section"><h3>${tr('yourCompany')}</h3>
    ${c.id ? `<div class="cust-pick internal-only"><span><strong>weclapp-Kunde${c.number ? ` ${esc(c.number)}` : ''}</strong><br><span class="subtle">Angebot und Auftrag werden bei diesem Kunden angelegt.</span></span><button class="btn btn-outline btn-small" data-action="unpick">Anderen Kunden wählen</button></div>`
    : `<div class="field internal-only"><label for="cust-q">Bestehenden Kunden in weclapp suchen</label><input id="cust-q" type="search" placeholder="Name oder Kundennummer …" autocomplete="off"></div><div id="cust-results" class="cust-results internal-only"></div><p class="subtle internal-only" style="margin:10px 0 16px">Oder als Neukunde erfassen. Der Kunde wird erst bei der Unterschrift in weclapp angelegt.</p>`}
    <div class="g2">${field(tr('company'), 'customer.company', c.company, 'text', 'Muster GmbH', c.id ? 'disabled' : '')}${field(tr('contact'), 'customer.contact', c.contact, 'text', tr('namePh'))}${field(tr('mail'), 'customer.mail', c.mail, 'email', 'office@firma.at')}${field(tr('phone'), 'customer.phone', c.phone, 'tel', '+43 …')}${field(tr('place'), 'customer.place', c.place, 'text', tr('placePh'))}</div>
  </section>
  <section class="section"><h3>${tr('itEnv')}</h3><div class="g3">${field(tr('aUsers'), 'assets.users', st.assets.users, 'number')}${field(tr('aClients'), 'assets.clients', st.assets.clients, 'number')}${field(tr('aServers'), 'assets.servers', st.assets.servers, 'number')}${field(tr('aFw'), 'assets.firewalls', st.assets.firewalls, 'number')}${field(tr('aSites'), 'assets.sites', st.assets.sites, 'number')}</div><p class="hint">${tr('itHint')}</p></section>
  ${area(tr('goals'), 'intakeNotes', st.intakeNotes, tr('goalsPh'))}`;
}
function internalStep() {
  return `<span class="eyebrow">02 · Interne Managemententscheidung</span><h2>Kundenbeziehung bewusst einordnen.</h2><p class="lead">Die Kategorie steuert die interne Kundenentwicklung. Sie bestimmt nicht automatisch den vertraglich zugesagten Servicelevel und erscheint nie im Angebot.</p>
  <div class="section"><div class="field"><label for="f-cat">Kundenkategorie – ausschließlich intern</label><select id="f-cat" data-path="internal.category">${['Gold', 'Silber', 'Bronze', 'Registered'].map((x) => `<option ${st.internal.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="stripe"></div><h3>Entscheidungsdimensionen</h3>
  ${RATINGS.map(([k, v]) => `<div class="score-row"><label for="score-${k}">${v}</label><input id="score-${k}" type="range" min="1" max="5" data-path="internal.ratings.${k}" value="${st.internal.ratings[k]}"><strong>${st.internal.ratings[k]}</strong></div>`).join('')}
  <p class="subtle" style="margin-top:12px">1 = niedrig, 5 = hoch. Hohe Aufwandseffizienz bedeutet geringer Betreuungsaufwand relativ zum Ertrag.</p></div>
  ${area('Interne Begründung', 'internal.reason', st.internal.reason, 'Warum genau diese Kategorie?')}<p class="hint">Ein loyaler, langjähriger Kunde kann Gold sein, auch wenn sein Umsatz klein ist. Das bedeutet noch kein kostenloses Premium-SLA.</p>`;
}

function planCard(key) {
  const r = cat.sla.rates[key], sel = st.sla === key;
  return `<label class="plan ${sel ? 'active' : ''}"><input type="radio" name="sla" value="${key}" data-path="sla" ${sel ? 'checked' : ''}><div class="plan-title">${esc(cat.sla.labels[key])}</div><div class="plan-price">${amt(r.base)}</div><div class="plan-meta">${tr('perUser', amt(r.user))}</div><div class="plan-badge">${tr('p1', esc(r.p1))}</div></label>`;
}
function productCard(p) {
  const s = st.products.find((x) => x.id === p.id);
  const q = count(s.qty), tier = p.threshold && q >= p.threshold, price = tier ? p.tier : p.price;
  return `<article class="service ${s.selected ? 'active' : ''}" data-card="${p.id}"><div class="svc-head"><input type="checkbox" aria-label="${esc(p.name)} ${tr('select')}" data-path="products.${p.id}.selected" ${s.selected ? 'checked' : ''}><div><strong>${esc(p.name)}</strong><div class="subtle">${tr('perUnit', esc(p.unit))}</div></div></div>
  <p class="svc-desc">${esc(p.brief)}</p>
  <div class="svc-footer"><div><div class="svc-price"><span data-price>${amt(price)}</span><small>${tr('netPer', esc(p.unit))}</small></div>${p.threshold ? `<div class="svc-extra" data-tier>${tier ? tr('tierActive') : tr('tierFrom', p.threshold, amt(p.tier))}</div>` : ''}</div>
  <div class="qty"><button type="button" data-action="dec" data-id="${p.id}" aria-label="${esc(p.name)} ${tr('less')}">−</button><input type="number" min="0" step="1" inputmode="numeric" value="${q}" data-path="products.${p.id}.qty" aria-label="${tr('qtyOf')} ${esc(p.name)}"><button type="button" data-action="inc" data-id="${p.id}" aria-label="${esc(p.name)} ${tr('more')}">+</button></div></div>
  <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap" class="internal-only"><span class="subtle">${esc(p.sku)}</span><span class="pill ${p.verified ? '' : 'warn'}">${p.verified ? 'Dokumentengrundlage' : 'Beschreibung offen'}</span>${(cat.missingInWeclapp || []).includes(p.sku) ? '<span class="pill warn" title="In der Artikelzuordnung mit einem weclapp-Artikel verknüpfen">noch kein weclapp-Artikel</span>' : ''}</div>
  <details><summary>${tr('details')}</summary><div class="desc-section"><strong>${tr('scope')}</strong>\n${esc(p.scope)}</div><div class="desc-section"><strong>${tr('excl')}</strong>\n${esc(p.exclusions)}</div>
  <div class="internal-only"><div class="subtle">Quelle: ${esc(p.source)}.</div>${p.sourceCaveat ? `<p class="hint warning">${esc(p.sourceCaveat)}</p>` : ''}<label class="detailslabel" for="custom-${p.id}">Individueller Beschreibungstext (optional)</label><textarea id="custom-${p.id}" data-path="products.${p.id}.custom" placeholder="Bei Bedarf vollständige Ersatzbeschreibung für das Angebot eingeben.">${esc(s.custom)}</textarea></div></details></article>`;
}
function productsStep() {
  const missing = cat.missingInWeclapp || [];
  const gl = (g) => cat.groupLabels?.[g] || g;
  return `<span class="eyebrow">${tr('s3Eyebrow')}</span><h2>${tr('s3Title')}</h2><p class="lead">${tr('s3Lead')}</p>
  ${missing.length ? `<div class="hint critical internal-only" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><span><strong>${missing.length} Board-Position(en) ohne weclapp-Artikel.</strong> Angebote mit diesen Positionen können nach der Unterschrift nicht angelegt werden (der Vorgang bleibt gespeichert).</span><button class="btn btn-outline btn-small" data-action="articles">Artikel zuordnen</button></div>` : ''}
  ${cat.weclappError ? `<div class="hint warning internal-only">Artikelabgleich mit weclapp nicht möglich: ${esc(cat.weclappError)}</div>` : ''}
  <section class="section"><h3>${tr('slaHead')}</h3><div class="plans">${['standard', 'priority', 'premium'].map(planCard).join('')}</div>
  <label class="checkline"><input type="radio" name="sla" value="none" data-path="sla" ${st.sla === 'none' ? 'checked' : ''}><span><strong>${tr('noSla')}</strong><small>${tr('noSlaSub')}</small></span></label>
  <div class="g2" style="margin-top:15px"><div class="field"><label for="f-review">${tr('review')}</label><select id="f-review" data-path="review"><option value="none" ${st.review === 'none' ? 'selected' : ''}>${tr('reviewNone')}</option><option value="annual" ${st.review === 'annual' ? 'selected' : ''}>${tr('reviewAnnual', amt(cat.sla.reviews.annual))}</option><option value="quarter" ${st.review === 'quarter' ? 'selected' : ''}>${tr('reviewQuarter', amt(cat.sla.reviews.quarter))}</option></select></div></div>
  ${check('setup', st.setup, tr('setupCheck', amt(cat.sla.setup)), tr('setupSub'))}
  <details><summary>${tr('compare')}</summary><div style="overflow:auto"><table class="cmp"><thead><tr><th>${tr('prio')}</th>${['standard', 'priority', 'premium'].map((s) => `<th>${esc(cat.sla.labels[s])}</th>`).join('')}</tr></thead><tbody>${['p1', 'p2', 'p3', 'p4'].map((k, i) => `<tr><td>${tr('prios')[i]}</td>${['standard', 'priority', 'premium'].map((s) => `<td>${esc(cat.sla.rates[s][k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="subtle">${tr('compareNote')}</p></details></section>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:9px;flex-wrap:wrap;margin:22px 0"><strong>${tr('catalog')}</strong><button class="btn btn-outline btn-small" data-action="quantities">${tr('suggestQty')}</button></div>
  ${cat.groups.map((g, i) => `<div class="category-head"><h3>${String(i + 1).padStart(2, '0')} · ${esc(gl(g))}</h3><span class="subtle">${tr('articles', cat.products.filter((p) => p.group === g).length)}</span></div><div class="service-grid">${cat.products.filter((p) => p.group === g).map(productCard).join('')}</div>`).join('')}
  <section class="section" style="margin-top:27px"><h3>${tr('project')}</h3>${check('project.enabled', st.project.enabled, tr('projectCheck'))}<div class="g2">${field(tr('projectName'), 'project.name', st.project.name, 'text', tr('projectPh'))}${field(tr('projectPrice'), 'project.price', st.project.price, 'number')}</div></section>
  ${warnBox()}`;
}
function table(items) {
  if (!items.length) return `<p class="subtle">${tr('none')}</p>`;
  return `<div class="offerwrap"><table><thead><tr><th>${tr('thService')}</th><th>${tr('thQty')}</th><th>${tr('thPrice')}</th><th>${tr('thSum')}</th></tr></thead><tbody>${items.map((p) => `<tr><td><strong>${esc(p.name)}</strong>${st.includeDetails ? `<div class="detail">${esc(p.desc)}</div>` : ''}</td><td>${p.qty}</td><td>${amt(p.price)}</td><td><strong>${amt(p.qty * p.price)}</strong></td></tr>`).join('')}</tbody></table></div>`;
}
function offerDoc() {
  const d = itemData(), t = totals(), c = st.customer;
  const a = Object.fromEntries(Object.entries(st.assets).map(([k, v]) => [k, count(v)]));
  return `<article class="offer"><div class="offer-header"><div><img class="offer-logo" src="/img/logo-light-bg.png" alt="${esc(cat.company.name)}"><p class="subtle" style="margin:11px 0 0">${esc([cat.company.address, cat.company.email].filter(Boolean).join(' · '))}</p></div><span class="pill dark">${tr('draftPill')}</span></div><div class="stripe"></div>
  <h3>${tr('docTitle')}</h3><p><strong>${tr('for')}</strong> ${esc(c.company || tr('newCustomer'))}<br>${esc(c.contact)}${c.place ? ` · ${esc(c.place)}` : ''}<br><span class="subtle">${tr('assetsLine', a)}</span></p>
  <h4>${tr('monthlyHead')}</h4>${table(d.monthly)}<div class="offer-summary"><div class="moneyline"><span>${tr('monthlyNet')}</span><b>${amt(t.monthly)}</b></div></div>
  <h4>${tr('onceHead')}</h4>${table(d.once)}<div class="offer-summary"><div class="moneyline"><span>${tr('onceNet')}</span><b>${amt(t.once)}</b></div><div class="moneyline"><span>${tr('firstNet')}</span><b>${amt(t.first)}</b></div><div class="moneyline"><span>${tr('vat', cat.vatPercent)}</span><b>${amt(t.vat)}</b></div><div class="moneyline"><strong>${tr('firstGross')}</strong><b>${amt(t.gross)}</b></div><div class="moneyline"><span>${tr('arr')}</span><b>${amt(t.arr)}</b></div></div>
  <div class="offer-notes"><strong>${tr('notesHead')}</strong><p>${esc(cat.offerNotesPreview)}</p>${st.notes ? `<p><strong>${tr('extra')}</strong> ${esc(st.notes)}</p>` : ''}</div></article>`;
}
function quoteStep() {
  return `<span class="eyebrow">${tr('s4Eyebrow')}</span><h2>${tr('s4Title')}</h2><p class="lead">${tr('s4Lead')}</p>
  <div style="margin-bottom:14px">${check('includeDetails', st.includeDetails, tr('showDetails'), tr('showDetailsSub'))}</div>
  ${offerDoc()}
  ${warnBox()}
  <section class="section" style="margin-top:18px">${area(tr('notes'), 'notes', st.notes, tr('notesPh'))}<div class="internal-only">${check('ready', st.ready, 'Intern zur Angebotserstellung geprüft', 'Pflicht, sobald Prüfpunkte offen sind. Vertragsbedingungen und Produktbeschreibungen freigeben.')}</div></section>
  <div style="display:flex;flex-wrap:wrap;gap:10px"><button class="btn btn-outline" data-action="pdf">${tr('pdf')}</button><button class="btn btn-primary" data-action="tosign">${tr('toSign')}</button></div>`;
}
function signStep() {
  if (result) return doneBox();
  const t = totals();
  return `<span class="eyebrow">${tr('s5Eyebrow')}</span><h2>${tr('s5Title')}</h2><p class="lead">${tr('s5Lead')}</p>
  <section class="section"><div class="moneyline"><span>${tr('mMonthly')}</span><b>${amt(t.monthly)}</b></div><div class="moneyline"><span>${tr('onceNet')}</span><b>${amt(t.once)}</b></div><div class="moneyline"><span>${tr('firstGross')}</span><b>${amt(t.gross)}</b></div></section>
  <section class="section"><div class="g2">${field(tr('signer'), 'signer.name', st.signer.name || st.customer.contact, 'text', tr('namePh'))}${field(tr('role'), 'signer.role', st.signer.role, 'text', tr('rolePh'))}</div>${field(tr('copyMail'), 'signer.email', st.signer.email || st.customer.mail, 'email')}
  <div class="field" style="margin-top:12px"><label>${tr('signature')}</label><div class="sign-wrap"><canvas id="sign" aria-label="${tr('signature')}"></canvas><div class="sign-line"></div><span class="sign-hint" id="sign-hint">${tr('signHint')}</span></div><div><button class="btn btn-outline btn-small" data-action="clearsign" style="margin-top:8px">${tr('clearSign')}</button></div></div>
  ${check('accepted', st.accepted, tr('accept'), tr('terms', esc(cat.termsUrl), esc(cat.company.name)))}
  <p id="sign-error" class="error" role="alert" hidden></p>
  <button class="btn btn-primary btn-big" data-action="sign" id="sign-btn">${tr('signBtn')}</button></section>`;
}
function doneBox() {
  const r = result, w = r.weclapp || {};
  const mail = r.signer.email || r.customer.mail || '';
  const subject = tr('mailSubject', w.salesOrderNumber);
  const body = tr('mailBody', r.signer.name, amt(r.totals.monthly), amt(r.totals.once), ctx.me.user.name, cat.company.name);
  return `<section class="section" style="text-align:center;padding:34px 24px"><div class="done-check" aria-hidden="true">✓</div><h2 style="margin-top:14px">${tr('done')}</h2><p class="lead" style="margin:0 auto 10px">${esc(tr('signedBy', r.customer.company, r.signer.name, new Date(r.signedAt).toLocaleString(LOC(), { dateStyle: 'short', timeStyle: 'short' })))}</p>
  <p style="font-size:18px"><b>${amt(r.totals.monthly)}</b> ${tr('monthlyNetShort')}${r.totals.once ? ` · <b>${amt(r.totals.once)}</b> ${tr('onceShort')}` : ''}</p>
  ${w.quotationNumber ? `<div class="hint internal-only" style="text-align:left"><strong>In weclapp angelegt:</strong> ${w.partyCreated ? `Neukunde ${esc(r.customer.number || '')} · ` : ''}Angebot ${esc(w.quotationNumber)} (angenommen)${w.salesOrderNumber ? ` · Auftrag ${esc(w.salesOrderNumber)}` : ''} · PDF angehängt.</div>` : ''}
  ${r.warningsWeclapp?.length ? `<div class="hint warning internal-only" style="text-align:left"><strong>Bitte prüfen:</strong><ul>${r.warningsWeclapp.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${w.quotationNumber ? '' : 'Die Unterschrift ist sicher gespeichert. Übertragung erneut starten, sobald das Problem behoben ist.'}</div>` : ''}
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px"><a class="btn btn-primary btn-big" href="${esc(r.pdfUrl)}" target="_blank" rel="noopener">${tr('openPdf')}</a>${mail ? `<a class="btn btn-outline btn-big internal-only" href="mailto:${esc(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">${tr('mailBtn')}</a>` : ''}${!w.quotationNumber ? `<button class="btn btn-outline btn-big internal-only" data-action="retry">${tr('retry')}</button>` : ''}<button class="btn btn-outline btn-big internal-only" data-action="toonboard">${tr('toOnboard')}</button></div>
  ${mail ? '<p class="subtle internal-only" style="margin-top:12px">Beim E-Mail-Versand das PDF bitte anhängen.</p>' : ''}</section>`;
}
function onboardStep() {
  const checks = cat.onboardingChecks;
  if (!result) return `<span class="eyebrow">06 · Übergabe in den Regelbetrieb</span><h2>Vom Angebot zur laufenden Betreuung.</h2><div class="hint">Die Onboarding-Checkliste wird nach der Unterschrift mit dem Auftrag gespeichert.</div>`;
  const done = result.onboarding || checks.map(() => false);
  const n = done.filter(Boolean).length;
  return `<span class="eyebrow">06 · Übergabe in den Regelbetrieb</span><h2>Vom Angebot zur laufenden Betreuung.</h2><p class="lead">Die Checkliste dokumentiert den Übergang von Vertrieb über Technik bis zur monatlichen Abrechnung. Sie wird mit dem Auftrag gespeichert.</p>
  <section class="section"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3>Fortschritt</h3><strong>${n} von ${checks.length}</strong></div><div class="progress-track"><span class="progress-fill" style="width:${(100 * n) / checks.length}%"></span></div>
  <div style="margin-top:20px">${checks.map((text, i) => `<label class="checkline"><input type="checkbox" data-onboard="${i}" ${done[i] ? 'checked' : ''}><span><strong>${esc(text)}</strong></span></label>`).join('')}</div></section>
  <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" data-action="new">Neues Angebot beginnen</button></div>`;
}

function draftsView(list) {
  return `<span class="eyebrow">Gespeicherte Kundenstände</span><h2>Weiterarbeiten.</h2><p class="lead">Zwischengespeicherte Angebote aller Mitarbeiter. Unterschriebene Aufträge findest du unter „Vertrieb &amp; Finanzen“.</p>
  <div class="draftlist">${list.length ? list.map((d) => `<div class="row"><span><strong>${esc(d.company)}</strong><br><span class="subtle">${amt(d.monthly)} monatlich · ${esc(d.user)} · ${new Date(d.updatedAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</span></span><span style="display:flex;gap:8px"><button class="btn btn-primary btn-small" data-action="loaddraft" data-id="${esc(d.id)}">Öffnen</button><button class="btn btn-outline btn-small" data-action="deldraft" data-id="${esc(d.id)}">Löschen</button></span></div>`).join('') : '<p class="subtle">Keine gespeicherten Kundenstände.</p>'}</div>
  <div style="margin-top:20px"><button class="btn btn-outline" data-action="back">← Zurück zum Angebot</button></div>`;
}

function sidebar() {
  const t = totals();
  return `<div class="sticky"><div class="summary-title">${tr('sideTitle')}</div><h3 style="margin-bottom:16px">${tr('sideHead')}</h3>
  <div class="moneycard"><span class="subtle">${tr('mMonthly')}</span><div class="big-number" data-live="monthly">${amt(t.monthly)}</div><p>${tr('sideMonthlySub')}</p></div>
  <div class="moneycard"><span class="subtle">${tr('sideArr')}</span><div class="big-number" style="font-size:27px" data-live="arr">${amt(t.arr)}</div><p>${tr('sideArrSub')}</p></div>
  <div class="moneyline"><span>${tr('sideOnce')}</span><b data-live="once">${amt(t.once)}</b></div><div class="moneyline"><span>${tr('sideFirstNet')}</span><b data-live="first">${amt(t.first)}</b></div><div class="moneyline"><span>${tr('sideFirstGross')}</span><b data-live="gross">${amt(t.gross)}</b></div>
  <div class="section-title">${tr('config')}</div><div class="moneyline"><span>${tr('aUsers')}</span><b data-live="users">${count(st.assets.users)}</b></div><div class="moneyline"><span>${tr('mSla')}</span><b>${esc(cat.sla.labels[st.sla])}</b></div><div class="moneyline"><span>${tr('products')}</span><b>${st.products.filter((p) => p.selected && count(p.qty) > 0).length}</b></div>
  <div class="moneyline internal-only"><span>Interne Kategorie</span><b>${esc(st.internal.category)}</b></div>
  <div class="sidelinks" style="margin-top:22px">${result ? '' : `<button class="btn btn-primary" data-action="offer">${tr('viewOffer')}</button>`}<button class="btn btn-outline internal-only" data-action="save">Kundenstand speichern</button></div></div>`;
}
function render() {
  const t = totals();
  document.body.classList.toggle('kv', kv);
  const steps = tr('steps');
  const visible = steps.map((l, i) => [l, i]).filter(([, i]) => !(kv && i === 1));
  const main = view === 'drafts' ? '<p class="subtle">Lade …</p>' : view === 'articles' ? articlesView() : [customerStep, internalStep, productsStep, quoteStep, signStep, onboardStep][step]();
  const langBtn = `<span class="langswitch" role="group" aria-label="Sprache / Language">${['de', 'en'].map((l) => `<button type="button" class="btn btn-outline btn-small" data-action="lang" data-lang="${l}" aria-pressed="${lang() === l}">${l.toUpperCase()}</button>`).join('')}</span>`;
  root.innerHTML = `<div class="ob" lang="${lang()}">
  <div class="top"><div class="top-inner"><div class="brandrow"><img src="/img/logo-dark-bg.png" alt="${esc(cat.company.name)}"><div class="tools"><span class="pill dark">${kv ? tr('customerView') : tr('internalApp')}</span>${langBtn}<button class="btn btn-outline btn-small" data-action="mode">${kv ? tr('endCustomer') : tr('toCustomer')}</button><span class="internal-only" style="display:contents"><button class="btn btn-outline btn-small" data-action="save">Kundenstand speichern</button><button class="btn btn-outline btn-small" data-action="drafts">Gespeicherte laden</button><button class="btn btn-outline btn-small" data-action="articles">Artikelzuordnung</button><button class="btn btn-outline btn-small" data-action="new">Neu</button></span></div></div>
  <div class="hero"><div><div class="eyebrow">${esc(cat.company.name.toUpperCase())} · ${tr('heroEyebrow')}</div><h1>${tr('heroTitle')}</h1><p>${tr('heroText')}</p></div><div class="hero-note"><b>${tr('heroNoteB')}</b>${tr('heroNote')}</div></div></div></div>
  <div class="metricbar"><div class="metric"><span>${tr('mCustomer')}</span><b style="font-size:17px" data-live="company">${esc(st.customer.company || tr('newCustomer'))}</b><small data-live="userslabel">${tr('users', count(st.assets.users))}</small></div><div class="metric"><span>${tr('mSla')}</span><b>${esc(cat.sla.labels[st.sla])}</b><small>${tr('mSlaSub')}</small></div><div class="metric"><span>${tr('mMonthly')}</span><b data-live="monthly">${amt(t.monthly)}</b><small>${tr('mMonthlySub')}</small></div><div class="metric"><span>${tr('mOnboard')}</span><b>${result ? `${(result.onboarding || []).filter(Boolean).length}/${cat.onboardingChecks.length}` : '–'}</b><small>${result ? tr('mOnboardDone') : tr('mOnboardAfter')}</small></div></div>
  <div class="workspace"><div class="workspace-main">${view === 'board' ? `<nav class="stepbar" aria-label="${tr('mOnboard')}">${visible.map(([label, i]) => `<button class="step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}" data-step="${i}" ${result && i < 4 ? 'disabled' : ''}><span class="circle">${i + 1}</span>${label}</button>`).join('')}</nav>` : ''}
  <main id="ob-main">${main}${view === 'board' && step < 4 ? `<div class="foot-actions"><button class="btn btn-outline" data-action="prev" ${step === 0 ? 'disabled' : ''}>${tr('back')}</button><span class="subtle">${tr('stepOf', step + 1, steps.length)}</span><button class="btn btn-primary" data-action="next">${tr('next')}</button></div>` : ''}</main></div>
  <aside class="workspace-side">${sidebar()}</aside></div>
  <div class="mini"><span><small>${tr('mMonthly')}</small><b data-live="monthly">${amt(t.monthly)}</b></span><span><small>${tr('once')}</small><strong data-live="once">${amt(t.once)}</strong></span></div>
  </div>`;
  bind();
  if (view === 'drafts') loadDrafts();
  if (view === 'articles') loadArticles();
  if (step === 4 && !result && view === 'board') pad = signaturePad(root.querySelector('#sign'), () => { const h = root.querySelector('#sign-hint'); if (h) h.hidden = true; });
  if (step === 2 || step === 3) refreshWarnings();
}
function refreshLive() {
  const t = totals();
  const set = (k, v) => root.querySelectorAll(`[data-live="${k}"]`).forEach((el) => { el.textContent = v; });
  set('monthly', amt(t.monthly)); set('arr', amt(t.arr)); set('once', amt(t.once)); set('first', amt(t.first)); set('gross', amt(t.gross));
  set('users', count(st.assets.users)); set('userslabel', tr('users', count(st.assets.users))); set('company', st.customer.company || tr('newCustomer'));
}

function setValue(path, v, type) {
  const bits = path.split('.');
  let obj = st, key;
  if (bits[0] === 'products') { obj = st.products.find((p) => p.id === bits[1]); key = bits[2]; } else { for (let i = 0; i < bits.length - 1; i++) obj = obj?.[bits[i]]; key = bits[bits.length - 1]; }
  if (!obj) return;
  if (type === 'checkbox') obj[key] = Boolean(v);
  else if (type === 'number') obj[key] = money(v);
  else if (type === 'range') obj[key] = count(v);
  else obj[key] = v;
}

function updateCard(id) {
  const p = cat.products.find((x) => x.id === id), s = st.products.find((x) => x.id === id);
  const card = root.querySelector(`[data-card="${id}"]`);
  if (!card) return;
  const q = count(s.qty), tier = p.threshold && q >= p.threshold;
  card.classList.toggle('active', s.selected);
  card.querySelector('[data-price]').textContent = amt(tier ? p.tier : p.price);
  const ex = card.querySelector('[data-tier]');
  if (ex) ex.textContent = tier ? tr('tierActive') : tr('tierFrom', p.threshold, amt(p.tier));
  card.querySelector(`[data-path="products.${id}.selected"]`).checked = s.selected;
  const inp = card.querySelector(`[data-path="products.${id}.qty"]`);
  if (Number(inp.value) !== q) inp.value = q;
}

function bind() {
  const el = root.querySelector('.ob');
  el.addEventListener('click', onClick);
  el.addEventListener('input', (e) => {
    const t = e.target, path = t.dataset.path;
    if (t.id === 'cust-q') { clearTimeout(custSearchTimer); custSearchTimer = setTimeout(() => searchCustomers(t.value), 250); return; }
    if (!path || ['checkbox', 'radio', 'select-one'].includes(t.type)) return;
    setValue(path, t.value, t.type);
    if (t.type === 'range') { const d = t.closest('.score-row')?.querySelector('strong'); if (d) d.textContent = t.value; }
    if (path.startsWith('products.') && path.endsWith('.qty')) {
      const id = path.split('.')[1], s = st.products.find((x) => x.id === id);
      s.selected = count(s.qty) > 0; // Menge > 0 wählt das Produkt automatisch aus
      updateCard(id);
      refreshWarnings();
    }
    if (path.startsWith('assets.')) refreshWarnings();
    refreshLive();
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.onboard !== undefined) return saveOnboarding(Number(t.dataset.onboard), t.checked);
    const path = t.dataset.path;
    if (!path) return;
    setValue(path, t.type === 'checkbox' ? t.checked : t.value, t.type);
    if (path.startsWith('products.') && path.endsWith('.selected')) {
      const id = path.split('.')[1], s = st.products.find((x) => x.id === id);
      if (s.selected && !count(s.qty)) s.qty = 1;
      updateCard(id); refreshLive(); refreshWarnings();
      return;
    }
    if (['checkbox', 'radio', 'select-one'].includes(t.type) && !['accepted', 'ready', 'includeDetails'].includes(path)) { const y = window.scrollY; render(); window.scrollTo(0, y); return; }
    if (path === 'includeDetails') { const y = window.scrollY; render(); window.scrollTo(0, y); return; }
    refreshLive();
  });
  if (step === 0 && !st.customer.id && root.querySelector('#cust-q')) searchCustomers('');
}

async function searchCustomers(q) {
  const box = root.querySelector('#cust-results');
  if (!box) return;
  try {
    const { customers } = await ctx.api('/offer/customers?q=' + encodeURIComponent(q));
    box.innerHTML = customers.slice(0, 8).map((c) => `<button type="button" data-action="pick" data-id="${esc(c.id)}"><span>${esc(c.name)}</span><span class="subtle">${esc(c.number || '')}</span></button>`).join('') || '<p class="subtle">Kein weclapp-Kunde gefunden – als Neukunde erfassen.</p>';
  } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

async function pickCustomer(id) {
  const c = await ctx.api(`/offer/customers/${encodeURIComponent(id)}`);
  st.customer = { id: String(c.id), number: c.number || '', company: c.name, contact: c.contact || st.customer.contact, mail: c.email || '', phone: c.phone || '', place: c.address || '' };
}

async function saveOnboarding(i, val) {
  const checks = (result.onboarding || cat.onboardingChecks.map(() => false)).slice();
  checks[i] = val;
  try { result = await ctx.api(`/offer/${encodeURIComponent(result.id)}/onboarding`, { method: 'PUT', body: { checks } }); render(); } catch (e) { ctx.toast(e.message, true); }
}

async function loadDrafts() {
  try {
    const { drafts } = await ctx.api('/offer/drafts');
    const m = root.querySelector('#ob-main');
    if (m) m.innerHTML = draftsView(drafts);
  } catch (e) { ctx.toast(e.message, true); }
}

async function onClick(e) {
  const go = e.target.closest('[data-step]');
  if (go) { step = Number(go.dataset.step); view = 'board'; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  const top = () => window.scrollTo(0, 0);
  if (['artsearch', 'artsuggest', 'artset', 'artclear', 'artall'].includes(a)) return articleAction(a, b);
  if (a === 'articles') { view = 'articles'; art = { list: null, sug: {}, searchFor: null, results: [], busy: false }; render(); top(); return; }
  if (a === 'lang') {
    st.lang = b.dataset.lang === 'en' ? 'en' : 'de';
    try { await loadCatalog(st.lang); } catch (err) { ctx.toast(err.message, true); }
    const y = window.scrollY; render(); window.scrollTo(0, y); return;
  }
  if (a === 'next') { step = Math.min(STEPS.length - 1, step + 1); if (kv && step === 1) step = 2; render(); top(); }
  if (a === 'prev') { step = Math.max(0, step - 1); if (kv && step === 1) step = 0; render(); top(); }
  if (a === 'offer') { step = 3; view = 'board'; render(); top(); }
  if (a === 'tosign') { step = 4; render(); top(); }
  if (a === 'toonboard') { step = 5; render(); top(); }
  if (a === 'mode') { kv = !kv; if (kv && step === 1) step = 2; render(); }
  if (a === 'inc' || a === 'dec') {
    const s = st.products.find((x) => x.id === b.dataset.id);
    s.qty = Math.max(0, count(s.qty) + (a === 'inc' ? 1 : -1));
    s.selected = s.qty > 0;
    updateCard(s.id); refreshLive(); refreshWarnings();
  }
  if (a === 'quantities') {
    for (const p of st.products) {
      if (['secultimate', 'secprofessional', 'secnode', 'clientpremium', 'clientremote'].includes(p.id)) p.qty = count(st.assets.clients);
      if (['serverpremium', 'serverremote'].includes(p.id)) p.qty = count(st.assets.servers);
      if (cat.products.find((x) => x.id === p.id)?.group === 'Managed Firewall') p.qty = count(st.assets.firewalls);
    }
    render();
  }
  if (a === 'pick') { try { await pickCustomer(b.dataset.id); render(); } catch (err) { ctx.toast(err.message, true); } }
  if (a === 'unpick') { st.customer = { id: null, number: '', company: '', contact: '', mail: '', phone: '', place: '' }; render(); }
  if (a === 'save') {
    try { const r = await ctx.api('/offer/drafts', { method: 'POST', body: payload() }); st.draftId = r.id; ctx.toast('Kundenstand gespeichert'); } catch (err) { ctx.toast(err.message, true); }
  }
  if (a === 'drafts') { view = 'drafts'; render(); top(); }
  if (a === 'back') {
    if (catStale) { for (const k of Object.keys(catCache)) delete catCache[k]; try { await loadCatalog(lang()); catStale = false; } catch { /* alter Stand */ } }
    view = 'board'; render();
  }
  if (a === 'loaddraft') {
    try {
      const d = await ctx.api(`/offer/drafts/${encodeURIComponent(b.dataset.id)}`);
      const base = fresh();
      st = { ...base, ...d.state, draftId: d.id, products: base.products.map((p) => ({ ...p, ...(d.state.products || []).find((x) => x.id === p.id) })) };
      await loadCatalog(lang());
      result = null; step = 0; view = 'board'; render(); top();
    } catch (err) { ctx.toast(err.message, true); }
  }
  if (a === 'deldraft') {
    if (!confirm('Gespeicherten Kundenstand löschen?')) return;
    await ctx.api(`/offer/drafts/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' }).catch(() => {});
    loadDrafts();
  }
  if (a === 'new') {
    if (!result && (st.customer.company || st.products.some((p) => p.selected)) && !confirm('Aktuelles Angebot verwerfen und neu beginnen? (Vorher „Kundenstand speichern“, falls du weitermachen willst.)')) return;
    st = fresh(); result = null; step = 0; view = 'board'; render(); top();
  }
  if (a === 'pdf') {
    const w = window.open('', '_blank');
    try {
      const res = await ctx.api('/offer/preview', { method: 'POST', body: payload(), raw: true });
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location = url; else location.href = url;
    } catch (err) { w?.close(); ctx.toast(err.message, true); }
  }
  if (a === 'clearsign') { pad?.clear(); const h = root.querySelector('#sign-hint'); if (h) h.hidden = false; }
  if (a === 'sign') doSign(b);
  if (a === 'retry') {
    b.disabled = true;
    try { result = await ctx.api(`/offer/${encodeURIComponent(result.id)}/retry`, { method: 'POST' }); render(); } catch (err) { ctx.toast(err.message, true); b.disabled = false; }
  }
}

async function doSign(btn) {
  const err = root.querySelector('#sign-error');
  err.hidden = true;
  const v = (p) => root.querySelector(`[data-path="${p}"]`)?.value ?? '';
  st.signer = { name: v('signer.name'), role: v('signer.role'), email: v('signer.email') };
  st.accepted = root.querySelector('[data-path="accepted"]').checked;
  const problems = [];
  if (st.signer.name.trim().length < 3) problems.push(tr('errName'));
  if (!pad?.hasInk()) problems.push(tr('errSig'));
  if (!st.accepted) problems.push(tr('errAccept'));
  if (serverWarnings.length && !st.ready) problems.push(tr('errReady'));
  if (problems.length) { err.textContent = problems.join(' · '); err.hidden = false; return; }
  btn.disabled = true;
  btn.textContent = tr('sending');
  try {
    result = await ctx.api('/offer/sign', { method: 'POST', body: { ...payload(), signerName: st.signer.name, signerRole: st.signer.role, signerEmail: st.signer.email, acceptedTerms: true, signature: pad.toDataURL() } });
    if (st.draftId) ctx.api(`/offer/drafts/${encodeURIComponent(st.draftId)}`, { method: 'DELETE' }).catch(() => {});
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    btn.disabled = false; btn.textContent = tr('signBtn');
  }
}

function signaturePad(canvas, onInk) {
  const c2d = canvas.getContext('2d');
  let ink = 0, drawing = false, last = null;
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  c2d.lineCap = 'round'; c2d.lineJoin = 'round'; c2d.strokeStyle = '#1B2A6B'; c2d.fillStyle = '#1B2A6B'; c2d.lineWidth = 2.4;
  const pos = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); c2d.beginPath(); c2d.arc(last.x, last.y, 1.1, 0, Math.PI * 2); c2d.fill(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    for (const pe of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const p = pos(pe);
      c2d.beginPath(); c2d.moveTo(last.x, last.y); c2d.lineTo(p.x, p.y); c2d.stroke();
      ink += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
    }
    onInk?.();
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return { clear: () => { c2d.clearRect(0, 0, canvas.width, canvas.height); ink = 0; }, hasInk: () => ink > 60, toDataURL: () => canvas.toDataURL('image/png') };
}

// ---------- Artikelzuordnung (intern) ----------
let art = { list: null, sug: {}, searchFor: null, results: [], busy: false };

function articlesView() {
  if (!art.list) return '<p class="subtle">Lade Zuordnung aus weclapp …</p>';
  const missing = art.list.filter((p) => p.status === 'missing').length;
  const sugCount = Object.keys(art.sug).length;
  const groups = [...new Set(art.list.map((p) => p.group))];
  const row = (p) => {
    const a = p.article, sg = art.sug[p.sku];
    const state = p.status === 'missing'
      ? '<span class="pill warn">nicht zugeordnet</span>'
      : `<span class="pill">${p.status === 'mapped' ? 'zugeordnet' : 'gleiche Nummer'}</span>`;
    return `<div class="section" style="padding:16px 18px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:start">
        <div style="min-width:0"><strong>${esc(p.label)}</strong><div class="subtle">Board: ${esc(p.sku)}${p.price != null ? ` · ${amt(p.price)} / ${esc(p.unit)}` : ''}</div></div>
        <div>${state}</div>
      </div>
      ${a ? `<div class="moneyline" style="border:0;padding:8px 0 0"><span>weclapp: <strong>${esc(a.number)}</strong> · ${esc(a.name)}${a.active ? '' : ' <span class="pill warn">inaktiv</span>'}</span><b>${a.price != null ? amt(a.price) : '–'}</b></div>
        ${p.deviation ? `<div class="hint warning" style="margin:8px 0 0">Preis weicht ab: weclapp ${amt(a.price)}, Board ${amt(p.price)} (${p.deviation > 0 ? '+' : ''}${amt(p.deviation)}). Im Angebot gilt der Board-Preis.</div>` : ''}` : ''}
      ${!a && sg ? `<div class="hint" style="margin:10px 0 0;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span>Vorschlag: <strong>${esc(sg.number)}</strong> · ${esc(sg.name)}${sg.price != null ? ` · ${amt(sg.price)}` : ''} <span class="subtle">(${sg.score} % Übereinstimmung)</span></span><button class="btn btn-primary btn-small" data-action="artset" data-sku="${esc(p.sku)}" data-id="${esc(sg.id)}">Übernehmen</button></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-outline btn-small" data-action="artsearch" data-sku="${esc(p.sku)}">${a ? 'Anderen Artikel wählen' : 'Artikel suchen'}</button>
        ${p.status === 'mapped' ? `<button class="btn btn-outline btn-small" data-action="artclear" data-sku="${esc(p.sku)}">Zuordnung lösen</button>` : ''}
      </div>
      ${art.searchFor === p.sku ? `<div class="field" style="margin-top:12px"><label for="art-q">weclapp-Artikel suchen (Name oder Nummer)</label><input id="art-q" type="search" autocomplete="off" placeholder="z. B. Managed Client"></div><div class="cust-results" id="art-results">${artResults(p.sku)}</div>` : ''}
    </div>`;
  };
  return `<span class="eyebrow">Intern · Artikelzuordnung</span><h2>Board-Positionen mit weclapp verbinden.</h2>
  <p class="lead">Jede Position im Board braucht einen echten weclapp-Artikel. Erst dann können Angebot und Auftrag angelegt werden. Im Angebot gilt der Board-Preis, im PDF erscheint die weclapp-Artikelnummer.</p>
  <div class="hint ${missing ? 'warning' : ''}">${missing ? `<strong>${missing} von ${art.list.length} Positionen</strong> sind noch keinem weclapp-Artikel zugeordnet.` : '<strong>Alle Positionen sind zugeordnet.</strong>'} Positionen, die du nicht verkaufst (z. B. noch nicht freigegebene SLA-Pakete), können offen bleiben – sie blockieren nur Angebote, die sie enthalten.</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px"><button class="btn btn-outline" data-action="artsuggest" ${art.busy ? 'disabled' : ''}>${art.busy ? 'Suche Vorschläge …' : 'Vorschläge suchen'}</button>${sugCount ? `<button class="btn btn-primary" data-action="artall">Alle ${sugCount} Vorschläge übernehmen</button>` : ''}<button class="btn btn-outline" data-action="back">← Zurück zum Angebot</button></div>
  ${groups.map((g) => `<div class="category-head"><h3>${esc(g)}</h3></div>${art.list.filter((p) => p.group === g).map(row).join('')}`).join('')}`;
}

function artResults(sku) {
  if (!art.results.length) return '<p class="subtle">Mindestens 2 Zeichen eingeben.</p>';
  return art.results.map((a) => `<button type="button" data-action="artset" data-sku="${esc(sku)}" data-id="${esc(a.id)}"><span><strong>${esc(a.number)}</strong> · ${esc(a.name)}</span><span class="subtle">${a.price != null ? amt(a.price) : ''}</span></button>`).join('');
}

async function loadArticles() {
  try {
    const { positions } = await ctx.api('/offer/articles');
    art.list = positions;
  } catch (e) { ctx.toast(e.message, true); art.list = []; }
  drawArticles();
}

function drawArticles() {
  const m = root.querySelector('#ob-main');
  if (!m || view !== 'articles') return;
  m.innerHTML = articlesView();
  const q = m.querySelector('#art-q');
  if (q) {
    q.focus();
    q.addEventListener('input', () => {
      clearTimeout(custSearchTimer);
      custSearchTimer = setTimeout(async () => {
        try { art.results = (await ctx.api('/offer/articles/search?q=' + encodeURIComponent(q.value))).articles; } catch (e) { art.results = []; ctx.toast(e.message, true); }
        const box = m.querySelector('#art-results');
        if (box) box.innerHTML = artResults(art.searchFor);
      }, 250);
    });
  }
}

async function articleAction(a, b) {
  if (a === 'artsearch') { art.searchFor = art.searchFor === b.dataset.sku ? null : b.dataset.sku; art.results = []; drawArticles(); }
  if (a === 'artsuggest') {
    art.busy = true; drawArticles();
    try { art.sug = (await ctx.api('/offer/articles/suggest', { method: 'POST' })).suggestions; if (!Object.keys(art.sug).length) ctx.toast('Keine passenden Vorschläge gefunden'); } catch (e) { ctx.toast(e.message, true); }
    art.busy = false; drawArticles();
  }
  if (a === 'artset' || a === 'artclear') {
    try {
      const r = await ctx.api(`/offer/articles/${encodeURIComponent(b.dataset.sku)}`, { method: 'PUT', body: { articleId: a === 'artset' ? b.dataset.id : null } });
      art.list = r.positions;
      delete art.sug[b.dataset.sku];
      art.searchFor = null;
      catStale = true; // Katalog (fehlende Artikel) beim Zurückgehen neu laden
    } catch (e) { ctx.toast(e.message, true); }
    drawArticles();
  }
  if (a === 'artall') {
    for (const [sku, sg] of Object.entries(art.sug)) {
      try { art.list = (await ctx.api(`/offer/articles/${encodeURIComponent(sku)}`, { method: 'PUT', body: { articleId: sg.id } })).positions; delete art.sug[sku]; } catch (e) { ctx.toast(`${sku}: ${e.message}`, true); }
    }
    catStale = true;
    drawArticles();
  }
}
