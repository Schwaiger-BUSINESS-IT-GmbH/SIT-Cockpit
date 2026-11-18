// Angebotsboard im Stil von SIT_Angebotsboard_V4 – mit weclapp-Kunden, Entwürfen
// am Server, Unterschrift am Tablet und Onboarding-Checkliste je Auftrag.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const amt = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
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

const fresh = () => ({
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
    try { cat = await ctx.api('/offer/catalog'); } catch (e) {
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
  if (st.sla !== 'none') {
    const r = cat.sla.rates[st.sla], label = cat.sla.labels[st.sla];
    monthly.push({ sku: 'SLA', name: `Service-Level ${label} – Grundgebühr`, qty: 1, unit: 'Monat', price: r.base, desc: `Erstreaktionsziele: P1 ${r.p1}, P2 ${r.p2}, P3 ${r.p3}, P4 ${r.p4}. Die Reaktionszeit ist keine garantierte Entstörungszeit.` });
    if (count(st.assets.users)) monthly.push({ sku: 'SLA', name: `Service-Level ${label} – Benutzer`, qty: count(st.assets.users), unit: 'User', price: r.user, desc: 'Benutzerabhängiger Anteil der Service-Level-Betreuung.' });
    if (count(st.assets.sites) > 1) monthly.push({ sku: 'SLA', name: 'Zusätzlicher Standort', qty: count(st.assets.sites) - 1, unit: 'Standort', price: cat.sla.site, desc: 'Zuschlag je weiterem vereinbartem Betriebsstandort.' });
    if (st.review === 'annual') monthly.push({ sku: 'REVIEW', name: 'Jährliches IT-Service-Review', qty: 1, unit: 'Monat', price: cat.sla.reviews.annual, desc: 'Ein jährliches IT-Servicegespräch mit Vorbereitung und Ergebnisprotokoll.' });
    if (st.review === 'quarter') monthly.push({ sku: 'REVIEW', name: 'Quartalsweise IT-Strategiebetreuung', qty: 1, unit: 'Monat', price: cat.sla.reviews.quarter, desc: 'Vier IT-Strategie- und Servicegespräche pro Jahr inklusive Vorbereitung und Protokoll.' });
    if (st.setup) once.push({ sku: 'SETUP', name: 'SLA-Einrichtung und Dokumentation', qty: 1, unit: 'einmalig', price: cat.sla.setup, desc: 'Einmalige Standardkonfiguration und Dokumentation, bis zu 1,5 Stunden.' });
  }
  for (const p of cat.products) {
    const s = st.products.find((x) => x.id === p.id);
    if (!s?.selected || !count(s.qty)) continue;
    const price = p.threshold && count(s.qty) >= p.threshold ? p.tier : p.price;
    monthly.push({ sku: p.sku, name: p.name, qty: count(s.qty), unit: p.unit, price, desc: s.custom.trim() || `${p.scope}\n\nAbgrenzung / Voraussetzungen:\n${p.exclusions}` });
  }
  if (st.project.enabled && st.project.name.trim()) once.push({ sku: 'PROJEKT', name: st.project.name, qty: 1, unit: 'einmalig', price: money(st.project.price), desc: 'Einmalige zusätzliche Projektleistung gemäß separater Beschreibung.' });
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
  return `<span class="eyebrow">01 · Erstaufnahme</span><h2>Wofür braucht Ihr Betrieb IT?</h2><p class="lead">Wir beginnen beim Unternehmen, nicht beim Produkt. Danach entsteht aus Anzahl, Bedarf und Betreuung eine nachvollziehbare Kalkulation.</p>
  <section class="section"><h3>Ihr Unternehmen</h3>
    ${c.id ? `<div class="cust-pick"><span><strong>weclapp-Kunde${c.number ? ` ${esc(c.number)}` : ''}</strong><br><span class="subtle">Angebot und Auftrag werden bei diesem Kunden angelegt.</span></span><button class="btn btn-outline btn-small" data-action="unpick">Anderen Kunden wählen</button></div>`
    : `<div class="field internal-only"><label for="cust-q">Bestehenden Kunden in weclapp suchen</label><input id="cust-q" type="search" placeholder="Name oder Kundennummer …" autocomplete="off"></div><div id="cust-results" class="cust-results internal-only"></div><p class="subtle internal-only" style="margin:10px 0 16px">Oder als Neukunde erfassen. Der Kunde wird erst bei der Unterschrift in weclapp angelegt.</p>`}
    <div class="g2">${field('Unternehmen', 'customer.company', c.company, 'text', 'Muster GmbH', c.id ? 'disabled' : '')}${field('Ansprechpartner', 'customer.contact', c.contact, 'text', 'Vorname Nachname')}${field('E-Mail', 'customer.mail', c.mail, 'email', 'office@firma.at')}${field('Telefon', 'customer.phone', c.phone, 'tel', '+43 …')}${field('Ort / Hauptstandort', 'customer.place', c.place, 'text', 'Österreich')}</div>
  </section>
  <section class="section"><h3>IT-Umgebung</h3><div class="g3">${field('Benutzer', 'assets.users', st.assets.users, 'number')}${field('Clients / PCs', 'assets.clients', st.assets.clients, 'number')}${field('Server', 'assets.servers', st.assets.servers, 'number')}${field('FortiGate-Firewalls', 'assets.firewalls', st.assets.firewalls, 'number')}${field('Standorte', 'assets.sites', st.assets.sites, 'number')}</div><p class="hint">Die Benutzeranzahl steuert den SLA-Zuschlag. Die Mengen für Managed Services werden separat gewählt und können vom Inventar abweichen.</p></section>
  ${area('Ziele, Probleme und bestehende Betreuung', 'intakeNotes', st.intakeNotes, 'Was funktioniert gut? Was soll verbessert werden? Bestehende Verträge, Migrationsbedarf …')}`;
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
  return `<label class="plan ${sel ? 'active' : ''}"><input type="radio" name="sla" value="${key}" data-path="sla" ${sel ? 'checked' : ''}><div class="plan-title">${cat.sla.labels[key]}</div><div class="plan-price">${amt(r.base)}</div><div class="plan-meta">+ ${amt(r.user)} je Benutzer / Monat</div><div class="plan-badge">P1-Reaktion: ${esc(r.p1)}</div></label>`;
}

function productCard(p) {
  const s = st.products.find((x) => x.id === p.id);
  const q = count(s.qty), tier = p.threshold && q >= p.threshold, price = tier ? p.tier : p.price;
  return `<article class="service ${s.selected ? 'active' : ''}" data-card="${p.id}"><div class="svc-head"><input type="checkbox" aria-label="${esc(p.name)} auswählen" data-path="products.${p.id}.selected" ${s.selected ? 'checked' : ''}><div><strong>${esc(p.name)}</strong><div class="subtle">${esc(p.sku)} · je ${esc(p.unit)}</div></div></div>
  <p class="svc-desc">${esc(p.brief)}</p>
  <div class="svc-footer"><div><div class="svc-price"><span data-price>${amt(price)}</span><small>netto / ${esc(p.unit)} / Monat</small></div>${p.threshold ? `<div class="svc-extra" data-tier>${tier ? 'Staffelpreis aktiv' : `ab ${p.threshold} Stück: ${amt(p.tier)}`}</div>` : ''}</div>
  <div class="qty"><button type="button" data-action="dec" data-id="${p.id}" aria-label="${esc(p.name)} weniger">−</button><input type="number" min="0" step="1" inputmode="numeric" value="${q}" data-path="products.${p.id}.qty" aria-label="Anzahl ${esc(p.name)}"><button type="button" data-action="inc" data-id="${p.id}" aria-label="${esc(p.name)} mehr">+</button></div></div>
  <div style="margin-top:10px" class="internal-only"><span class="pill ${p.verified ? '' : 'warn'}">${p.verified ? 'Dokumentengrundlage' : 'Beschreibung offen'}</span></div>
  <details><summary>Leistungsumfang und Abgrenzung</summary><div class="desc-section"><strong>Leistungsumfang</strong>\n${esc(p.scope)}</div><div class="desc-section"><strong>Nicht enthalten / Voraussetzungen</strong>\n${esc(p.exclusions)}</div>
  <div class="internal-only"><div class="subtle">Quelle: ${esc(p.source)}.</div>${p.sourceCaveat ? `<p class="hint warning">${esc(p.sourceCaveat)}</p>` : ''}<label class="detailslabel" for="custom-${p.id}">Individueller Beschreibungstext (optional)</label><textarea id="custom-${p.id}" data-path="products.${p.id}.custom" placeholder="Bei Bedarf vollständige Ersatzbeschreibung für das Angebot eingeben.">${esc(s.custom)}</textarea></div></details></article>`;
}

function productsStep() {
  const missing = cat.missingInWeclapp || [];
  return `<span class="eyebrow">03 · Serviceauswahl</span><h2>Erst wofür. Dann womit.</h2><p class="lead">Wähle die benötigten Managed Services. Staffelpreise werden automatisch berücksichtigt. Alle Beträge netto und monatlich, sofern nicht anders gekennzeichnet.</p>
  ${missing.length ? `<div class="hint critical internal-only" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><span><strong>${missing.length} Board-Position(en) ohne weclapp-Artikel.</strong> Angebote mit diesen Positionen können nach der Unterschrift nicht angelegt werden (der Vorgang bleibt gespeichert).</span><button class="btn btn-outline btn-small" data-action="articles">Artikel zuordnen</button></div>` : ''}
  ${cat.weclappError ? `<div class="hint warning internal-only">Artikelabgleich mit weclapp nicht möglich: ${esc(cat.weclappError)}</div>` : ''}
  <section class="section"><h3>Service-Level – bei Bedarf zusätzlich</h3><div class="plans">${['standard', 'priority', 'premium'].map(planCard).join('')}</div>
  <label class="checkline"><input type="radio" name="sla" value="none" data-path="sla" ${st.sla === 'none' ? 'checked' : ''}><span><strong>Kein zusätzliches SLA</strong><small>Es gelten ausschließlich bereits wirksam vereinbarte produktspezifische Bedingungen oder individuelle Vereinbarungen.</small></span></label>
  <div class="g2" style="margin-top:15px"><div class="field"><label for="f-review">Zusätzliches IT-Review</label><select id="f-review" data-path="review"><option value="none" ${st.review === 'none' ? 'selected' : ''}>Keines</option><option value="annual" ${st.review === 'annual' ? 'selected' : ''}>Jährlich +${amt(cat.sla.reviews.annual)}/Monat</option><option value="quarter" ${st.review === 'quarter' ? 'selected' : ''}>Quartalsweise +${amt(cat.sla.reviews.quarter)}/Monat</option></select></div></div>
  ${check('setup', st.setup, `Einmalige SLA-Einrichtung – ${amt(cat.sla.setup)}`, 'Wird nur bei Auswahl eines zusätzlichen SLAs verrechnet.')}
  <details><summary>Reaktionszeiten aller SLA-Pakete vergleichen</summary><div style="overflow:auto"><table class="cmp"><thead><tr><th>Priorität</th><th>Standard</th><th>Priority</th><th>Premium</th></tr></thead><tbody>${[['P1 – kritisch', 'p1'], ['P2 – hoch', 'p2'], ['P3 – normal', 'p3'], ['P4 – niedrig', 'p4']].map(([a, k]) => `<tr><td>${a}</td>${['standard', 'priority', 'premium'].map((s) => `<td>${esc(cat.sla.rates[s][k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="subtle">Qualifizierte Erstreaktion während vertraglich vereinbarter Supportzeiten, keine garantierte Problemlösung.</p></details></section>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:9px;flex-wrap:wrap;margin:22px 0"><strong>Managed-Service-Katalog</strong><button class="btn btn-outline btn-small" data-action="quantities">Bestandsmengen vorschlagen</button></div>
  ${cat.groups.map((g, i) => `<div class="category-head"><h3>${String(i + 1).padStart(2, '0')} · ${esc(g)}</h3><span class="subtle">${cat.products.filter((p) => p.group === g).length} Artikel</span></div><div class="service-grid">${cat.products.filter((p) => p.group === g).map(productCard).join('')}</div>`).join('')}
  <section class="section" style="margin-top:27px"><h3>Einmaliges Projekt / Sondereinrichtung</h3>${check('project.enabled', st.project.enabled, 'Zusätzliche Projektposition aufnehmen')}<div class="g2">${field('Projektbezeichnung', 'project.name', st.project.name, 'text', 'z. B. Microsoft-365-Migration')}${field('Einmaliger Preis netto', 'project.price', st.project.price, 'number')}</div></section>
  ${warnBox()}`;
}

function table(items) {
  if (!items.length) return '<p class="subtle">Keine Positionen gewählt.</p>';
  return `<div class="offerwrap"><table><thead><tr><th>Leistung</th><th>Menge</th><th>Einzelpreis</th><th>Summe</th></tr></thead><tbody>${items.map((p) => `<tr><td><strong>${esc(p.name)}</strong>${st.includeDetails ? `<div class="detail">${esc(p.desc)}</div>` : ''}</td><td>${p.qty}</td><td>${amt(p.price)}</td><td><strong>${amt(p.qty * p.price)}</strong></td></tr>`).join('')}</tbody></table></div>`;
}

function offerDoc() {
  const d = itemData(), t = totals(), c = st.customer, a = st.assets;
  return `<article class="offer"><div class="offer-header"><div><img class="offer-logo" src="/img/logo-light-bg.png" alt="${esc(cat.company.name)}"><p class="subtle" style="margin:11px 0 0">${esc([cat.company.address, cat.company.email].filter(Boolean).join(' · '))}</p></div><span class="pill dark">Angebotsentwurf</span></div><div class="stripe"></div>
  <h3>IT-Betreuung und Managed Services</h3><p><strong>Für:</strong> ${esc(c.company || 'Neukunde')}<br>${esc(c.contact)}${c.place ? ` · ${esc(c.place)}` : ''}<br><span class="subtle">${count(a.users)} Benutzer · ${count(a.clients)} Clients · ${count(a.servers)} Server · ${count(a.firewalls)} FortiGate · ${count(a.sites)} Standorte</span></p>
  <h4>Monatlich wiederkehrende Dienstleistungen</h4>${table(d.monthly)}<div class="offer-summary"><div class="moneyline"><span>Monatlicher Nettobetrag</span><b>${amt(t.monthly)}</b></div></div>
  <h4>Einmalige Dienstleistungen</h4>${table(d.once)}<div class="offer-summary"><div class="moneyline"><span>Einmaliger Nettobetrag</span><b>${amt(t.once)}</b></div><div class="moneyline"><span>Erster Abrechnungsmonat netto</span><b>${amt(t.first)}</b></div><div class="moneyline"><span>${cat.vatPercent} % USt. (Standardfall Inland)</span><b>${amt(t.vat)}</b></div><div class="moneyline"><strong>Erster Abrechnungsmonat brutto</strong><b>${amt(t.gross)}</b></div><div class="moneyline"><span>Wiederkehrender Jahreswert netto</span><b>${amt(t.arr)}</b></div></div>
  <div class="offer-notes"><strong>Leistungs- und Vertragsabgrenzung</strong><p>${esc(cat.offerNotesPreview)}</p>${st.notes ? `<p><strong>Zusatzanmerkungen:</strong> ${esc(st.notes)}</p>` : ''}</div></article>`;
}

function quoteStep() {
  return `<span class="eyebrow">04 · Angebotsvorschau</span><h2>Ein Angebot, das Vertrauen schafft.</h2><p class="lead">Nur kundenfähige Informationen erscheinen im Angebot. Die interne Kundenkategorie bleibt verborgen.</p>
  <div style="margin-bottom:14px">${check('includeDetails', st.includeDetails, 'Leistungsbeschreibungen im Angebot anzeigen', 'Je nach Umfang kann das PDF dadurch mehrere Seiten enthalten.')}</div>
  ${offerDoc()}
  ${warnBox()}
  <section class="section" style="margin-top:18px">${area('Anmerkungen zum Angebot', 'notes', st.notes, 'Optionale Hinweise für den Kunden, z. B. Leistungsbeginn …')}<div class="internal-only">${check('ready', st.ready, 'Intern zur Angebotserstellung geprüft', 'Pflicht, sobald Prüfpunkte offen sind. Vertragsbedingungen und Produktbeschreibungen freigeben.')}</div></section>
  <div style="display:flex;flex-wrap:wrap;gap:10px"><button class="btn btn-outline" data-action="pdf">PDF-Vorschau</button><button class="btn btn-primary" data-action="tosign">Weiter zur Unterschrift →</button></div>`;
}

function signStep() {
  if (result) return doneBox();
  const t = totals();
  return `<span class="eyebrow">05 · Beauftragung</span><h2>Unterschreiben und loslegen.</h2><p class="lead">Mit der Unterschrift wird das Angebot in weclapp angelegt, angenommen und als Auftrag übernommen. Das unterschriebene PDF wird angehängt.</p>
  <section class="section"><div class="moneyline"><span>Monatlich netto</span><b>${amt(t.monthly)}</b></div><div class="moneyline"><span>Einmalig netto</span><b>${amt(t.once)}</b></div><div class="moneyline"><span>Erster Abrechnungsmonat brutto</span><b>${amt(t.gross)}</b></div></section>
  <section class="section"><div class="g2">${field('Name der unterschreibenden Person *', 'signer.name', st.signer.name || st.customer.contact, 'text', 'Vorname Nachname')}${field('Funktion', 'signer.role', st.signer.role, 'text', 'z. B. Geschäftsführung')}</div>${field('E-Mail für die Auftragskopie', 'signer.email', st.signer.email || st.customer.mail, 'email')}
  <div class="field" style="margin-top:12px"><label>Unterschrift *</label><div class="sign-wrap"><canvas id="sign" aria-label="Unterschriftsfeld"></canvas><div class="sign-line"></div><span class="sign-hint" id="sign-hint">Hier mit dem Finger oder Stift unterschreiben</span></div><div><button class="btn btn-outline btn-small" data-action="clearsign" style="margin-top:8px">Unterschrift löschen</button></div></div>
  ${check('accepted', st.accepted, 'Ich beauftrage die angeführten Leistungen zu den genannten Konditionen.', `Es gelten die <a href="${esc(cat.termsUrl)}" target="_blank" rel="noopener">AGB von ${esc(cat.company.name)}</a>.`)}
  <p id="sign-error" class="error" role="alert" hidden></p>
  <button class="btn btn-primary btn-big" data-action="sign" id="sign-btn">Verbindlich beauftragen</button></section>`;
}

function doneBox() {
  const r = result, w = r.weclapp || {};
  const mail = r.signer.email || r.customer.mail || '';
  const subject = `Ihr Auftrag IT-Betreuung und Managed Services${w.salesOrderNumber ? ` Nr. ${w.salesOrderNumber}` : ''}`;
  const body = `Guten Tag ${r.signer.name},\n\nvielen Dank für Ihren Auftrag. Im Anhang finden Sie die unterschriebene Auftragsübersicht.\n\nMonatlich: ${amt(r.totals.monthly)} netto\nEinmalig: ${amt(r.totals.once)} netto\n\nMit freundlichen Grüßen\n${ctx.me.user.name}\n${cat.company.name}`;
  return `<section class="section" style="text-align:center;padding:34px 24px"><div class="done-check" aria-hidden="true">✓</div><h2 style="margin-top:14px">Auftrag erteilt</h2><p class="lead" style="margin:0 auto 10px">${esc(r.customer.company)} · unterschrieben von ${esc(r.signer.name)} am ${new Date(r.signedAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</p>
  <p style="font-size:18px"><b>${amt(r.totals.monthly)}</b> monatlich netto${r.totals.once ? ` · <b>${amt(r.totals.once)}</b> einmalig` : ''}</p>
  ${w.quotationNumber ? `<div class="hint" style="text-align:left"><strong>In weclapp angelegt:</strong> ${w.partyCreated ? `Neukunde ${esc(r.customer.number || '')} · ` : ''}Angebot ${esc(w.quotationNumber)} (angenommen)${w.salesOrderNumber ? ` · Auftrag ${esc(w.salesOrderNumber)}` : ''} · PDF angehängt.</div>` : ''}
  ${r.warningsWeclapp?.length ? `<div class="hint warning" style="text-align:left"><strong>Bitte prüfen:</strong><ul>${r.warningsWeclapp.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${w.quotationNumber ? '' : 'Die Unterschrift ist sicher gespeichert. Übertragung erneut starten, sobald das Problem behoben ist.'}</div>` : ''}
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px"><a class="btn btn-primary btn-big" href="${esc(r.pdfUrl)}" target="_blank" rel="noopener">PDF öffnen</a>${mail ? `<a class="btn btn-outline btn-big" href="mailto:${esc(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">E-Mail an Kunden</a>` : ''}${!w.quotationNumber ? '<button class="btn btn-outline btn-big" data-action="retry">Erneut an weclapp senden</button>' : ''}<button class="btn btn-outline btn-big" data-action="toonboard">Weiter zum Onboarding →</button></div>
  ${mail ? '<p class="subtle" style="margin-top:12px">Beim E-Mail-Versand das PDF bitte anhängen.</p>' : ''}</section>`;
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
  return `<div class="sticky"><div class="summary-title">Ihre Kalkulation</div><h3 style="margin-bottom:16px">Planbare IT-Kosten.</h3>
  <div class="moneycard"><span class="subtle">Monatlich netto</span><div class="big-number" data-live="monthly">${amt(t.monthly)}</div><p>Wiederkehrender Vertragswert</p></div>
  <div class="moneycard"><span class="subtle">Jahreswert netto</span><div class="big-number" style="font-size:27px" data-live="arr">${amt(t.arr)}</div><p>12 Monate ohne einmalige Leistungen</p></div>
  <div class="moneyline"><span>Einmalig</span><b data-live="once">${amt(t.once)}</b></div><div class="moneyline"><span>Erster Monat netto</span><b data-live="first">${amt(t.first)}</b></div><div class="moneyline"><span>Erster Monat brutto</span><b data-live="gross">${amt(t.gross)}</b></div>
  <div class="section-title">Konfiguration</div><div class="moneyline"><span>Benutzer</span><b data-live="users">${count(st.assets.users)}</b></div><div class="moneyline"><span>Service-Level</span><b>${cat.sla.labels[st.sla]}</b></div><div class="moneyline"><span>Gewählte Produkte</span><b>${st.products.filter((p) => p.selected && count(p.qty) > 0).length}</b></div>
  <div class="moneyline internal-only"><span>Interne Kategorie</span><b>${esc(st.internal.category)}</b></div>
  <div class="sidelinks" style="margin-top:22px">${result ? '' : '<button class="btn btn-primary" data-action="offer">Angebot ansehen</button>'}<button class="btn btn-outline internal-only" data-action="save">Kundenstand speichern</button></div></div>`;
}

function render() {
  const t = totals();
  document.body.classList.toggle('kv', kv);
  const visible = STEPS.map((l, i) => [l, i]).filter(([, i]) => !(kv && i === 1));
  const main = view === 'drafts' ? '<p class="subtle">Lade …</p>' : view === 'articles' ? articlesView() : [customerStep, internalStep, productsStep, quoteStep, signStep, onboardStep][step]();
  root.innerHTML = `<div class="ob">
  <div class="top"><div class="top-inner"><div class="brandrow"><img src="/img/logo-dark-bg.png" alt="${esc(cat.company.name)}"><div class="tools"><span class="pill dark">${kv ? 'KUNDENANSICHT' : 'INTERNE ANWENDUNG'}</span><button class="btn btn-outline btn-small" data-action="mode">${kv ? 'Kundenansicht beenden' : 'Zur Kundenansicht'}</button><span class="internal-only" style="display:contents"><button class="btn btn-outline btn-small" data-action="save">Kundenstand speichern</button><button class="btn btn-outline btn-small" data-action="drafts">Gespeicherte laden</button><button class="btn btn-outline btn-small" data-action="articles">Artikelzuordnung</button><button class="btn btn-outline btn-small" data-action="new">Neu</button></span></div></div>
  <div class="hero"><div><div class="eyebrow">${esc(cat.company.name.toUpperCase())} · KUNDEN-ONBOARDING</div><h1>Ihre IT. <span>Unser Plan.</span></h1><p>Vom ersten Gespräch bis zum kalkulierten Managed-Service-Angebot. Klar, nachvollziehbar und auf Ihren Betrieb abgestimmt.</p></div><div class="hero-note"><b>Erst wofür. Dann womit.</b>Beratung · Umsetzung · Betreuung</div></div></div></div>
  <div class="metricbar"><div class="metric"><span>Kunde</span><b style="font-size:17px" data-live="company">${esc(st.customer.company || 'Neukunde')}</b><small data-live="userslabel">${count(st.assets.users)} Benutzer</small></div><div class="metric"><span>Service-Level</span><b>${cat.sla.labels[st.sla]}</b><small>Separat kalkuliert</small></div><div class="metric"><span>Monatlich netto</span><b data-live="monthly">${amt(t.monthly)}</b><small>Inkl. Managed Services</small></div><div class="metric"><span>Onboarding</span><b>${result ? `${(result.onboarding || []).filter(Boolean).length}/${cat.onboardingChecks.length}` : '–'}</b><small>${result ? 'Abgeschlossene Schritte' : 'Nach Unterschrift'}</small></div></div>
  <div class="workspace"><div class="workspace-main">${view === 'board' ? `<nav class="stepbar" aria-label="Angebotsprozess">${visible.map(([label, i]) => `<button class="step ${step === i ? 'active' : ''} ${step > i ? 'done' : ''}" data-step="${i}" ${result && i < 4 ? 'disabled' : ''}><span class="circle">${i + 1}</span>${label}</button>`).join('')}</nav>` : ''}
  <main id="ob-main">${main}${view === 'board' && step < 4 ? `<div class="foot-actions"><button class="btn btn-outline" data-action="prev" ${step === 0 ? 'disabled' : ''}>← Zurück</button><span class="subtle">Schritt ${step + 1} von ${STEPS.length}</span><button class="btn btn-primary" data-action="next">Weiter →</button></div>` : ''}</main></div>
  <aside class="workspace-side">${sidebar()}</aside></div>
  <div class="mini"><span><small>Monatlich netto</small><b data-live="monthly">${amt(t.monthly)}</b></span><span><small>Einmalig</small><strong data-live="once">${amt(t.once)}</strong></span></div>
  </div>`;
  bind();
  if (view === 'drafts') loadDrafts();
  if (view === 'articles') loadArticles();
  if (step === 4 && !result && view === 'board') pad = signaturePad(root.querySelector('#sign'), () => { const h = root.querySelector('#sign-hint'); if (h) h.hidden = true; });
  if (step === 2) refreshWarnings();
  if (step === 3) refreshWarnings();
}

function refreshLive() {
  const t = totals();
  const set = (k, v) => root.querySelectorAll(`[data-live="${k}"]`).forEach((el) => { el.textContent = v; });
  set('monthly', amt(t.monthly)); set('arr', amt(t.arr)); set('once', amt(t.once)); set('first', amt(t.first)); set('gross', amt(t.gross));
  set('users', count(st.assets.users)); set('userslabel', `${count(st.assets.users)} Benutzer`); set('company', st.customer.company || 'Neukunde');
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
  if (ex) ex.textContent = tier ? 'Staffelpreis aktiv' : `ab ${p.threshold} Stück: ${amt(p.tier)}`;
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
    if (catStale) { try { cat = await ctx.api('/offer/catalog'); catStale = false; } catch { /* alter Stand */ } }
    view = 'board'; render();
  }
  if (a === 'loaddraft') {
    try {
      const d = await ctx.api(`/offer/drafts/${encodeURIComponent(b.dataset.id)}`);
      const base = fresh();
      st = { ...base, ...d.state, draftId: d.id, products: base.products.map((p) => ({ ...p, ...(d.state.products || []).find((x) => x.id === p.id) })) };
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
  if (st.signer.name.trim().length < 3) problems.push('Name der unterschreibenden Person fehlt');
  if (!pad?.hasInk()) problems.push('Unterschrift fehlt');
  if (!st.accepted) problems.push('Bitte die Beauftragung bestätigen');
  if (serverWarnings.length && !st.ready) problems.push('Offene Prüfpunkte: im Schritt „Angebot“ intern freigeben');
  if (problems.length) { err.textContent = problems.join(' · '); err.hidden = false; return; }
  btn.disabled = true;
  btn.textContent = 'Wird übertragen …';
  try {
    result = await ctx.api('/offer/sign', { method: 'POST', body: { ...payload(), signerName: st.signer.name, signerRole: st.signer.role, signerEmail: st.signer.email, acceptedTerms: true, signature: pad.toDataURL() } });
    if (st.draftId) ctx.api(`/offer/drafts/${encodeURIComponent(st.draftId)}`, { method: 'DELETE' }).catch(() => {});
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    btn.disabled = false; btn.textContent = 'Verbindlich beauftragen';
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
