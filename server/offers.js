// Angebotsboard: Managed-Service-Katalog aus weclapp, Preisberechnung am Server,
// Unterschrift -> PDF -> Angebot in weclapp (angenommen) -> optional Auftrag.
// Jeder unterschriebene Vorgang wird ZUERST lokal gesichert, damit eine
// Unterschrift nie verloren geht, auch wenn weclapp gerade nicht erreichbar ist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { request, unwrap, uploadDocument, WeclappError } from './weclapp.js';
import { customerContact } from './sales.js';
import { renderOfferPdf } from './pdf.js';

const dir = path.join(config.dataDir, 'offers');
fs.mkdirSync(dir, { recursive: true });

const get = (token, p, query) => request(token, 'GET', p, { query }).then(unwrap);
const n = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const round2 = (x) => Math.round(x * 100) / 100;

// Optionale Feinsteuerung: config/angebotsboard.json (Gruppen, Einheiten-Texte, Abrechnung)
export function boardSettings() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../config/angebotsboard.json', import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}

const ONCE = /einricht|setup|onboarding|installation|einmalig|inbetriebnahme|migration/i;

function pickPrice(article, now = Date.now()) {
  const prices = (article.articlePrices || []).filter((p) =>
    !p.customerId
    && (!p.salesChannel || p.salesChannel === 'NET1')
    && (!p.startDate || n(p.startDate) <= now)
    && (!p.endDate || n(p.endDate) >= now));
  prices.sort((a, b) => n(a.priceScaleValue) - n(b.priceScaleValue));
  return prices.length ? n(prices[0].price) : null;
}

let catalogCache = { at: 0, data: null };

/** Managed-Service-Artikel mit Preisen, gruppiert für das Board */
export async function catalog(token, { fresh = false } = {}) {
  if (!fresh && catalogCache.data && Date.now() - catalogCache.at < 300e3) return catalogCache.data;
  const settings = boardSettings();
  const props = 'id,articleNumber,name,description,shortDescription1,unitId,articlePrices,articleCategoryId,active';
  let rows = [];
  let categoryId = null;
  const cats = await get(token, '/articleCategory', { 'name-eq': config.offerArticleCategory, pageSize: 5 }).catch(() => []);
  if (cats[0]) {
    categoryId = cats[0].id;
    rows = await get(token, '/article', { 'articleCategoryId-eq': categoryId, 'active-eq': true, properties: props, pageSize: 500 });
  }
  if (config.offerArticleNumbers.length) {
    const extra = await get(token, '/article', { 'articleNumber-in': JSON.stringify(config.offerArticleNumbers), properties: props, pageSize: 500 });
    const seen = new Set(rows.map((r) => r.id));
    rows.push(...extra.filter((r) => !seen.has(r.id)));
  }
  const units = Object.fromEntries((await get(token, '/unit', { pageSize: 500 }).catch(() => [])).map((u) => [u.id, u.name]));

  const per = settings.articles || {};
  const items = rows.map((a) => {
    const s = per[a.articleNumber] || {};
    const billing = s.billing || (ONCE.test(`${a.name} ${a.articleNumber}`) ? 'once' : 'monthly');
    return {
      id: String(a.id),
      number: a.articleNumber,
      name: s.name || a.name,
      description: s.description || stripHtml(a.shortDescription1 || a.description || ''),
      unit: s.unit || units[a.unitId] || 'Stk.',
      price: s.price != null ? n(s.price) : pickPrice(a),
      billing,
      group: s.group || (billing === 'once' ? 'Einmalige Leistungen' : 'Managed Services'),
      sort: s.sort ?? 999,
      step: s.step || 1,
      highlight: !!s.highlight,
    };
  }).filter((x) => x.price != null);

  const order = settings.groups || [];
  const groups = [];
  for (const it of items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'))) {
    let g = groups.find((x) => x.name === it.group);
    if (!g) groups.push(g = { name: it.group, items: [] });
    g.items.push(it);
  }
  groups.sort((a, b) => {
    const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a.name === 'Einmalige Leistungen') - (b.name === 'Einmalige Leistungen');
  });

  const data = {
    groups,
    category: config.offerArticleCategory,
    categoryFound: !!categoryId,
    missingPrices: rows.length - items.length,
    terms: settings.terms || [12, 24, 36],
    defaultTerm: settings.defaultTerm || 36,
    termDiscounts: settings.termDiscounts || {},
    maxDiscount: settings.maxDiscount ?? 20,
    vatPercent: config.vatPercent,
    termsUrl: config.termsUrl,
    companyName: config.companyName,
  };
  catalogCache = { at: Date.now(), data };
  return data;
}

function stripHtml(s) {
  return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

/** Positionen und Summen am Server berechnen – Preise kommen nie vom Browser */
export async function calculate(token, input) {
  const cat = await catalog(token);
  const byId = new Map(cat.groups.flatMap((g) => g.items).map((i) => [i.id, i]));
  const term = cat.terms.includes(Number(input.termMonths)) ? Number(input.termMonths) : cat.defaultTerm;
  const termDiscount = n(cat.termDiscounts[term]);
  const manual = Math.min(Math.max(n(input.discountPercent), 0), cat.maxDiscount);
  const discount = Math.min(termDiscount + manual, cat.maxDiscount);

  const lines = [];
  for (const raw of input.items || []) {
    const art = byId.get(String(raw.articleId));
    const qty = Math.round(n(raw.quantity) * 100) / 100;
    if (!art || qty <= 0) continue;
    const lineDiscount = art.billing === 'monthly' ? discount : 0;
    const net = round2(art.price * qty * (1 - lineDiscount / 100));
    lines.push({ articleId: art.id, number: art.number, name: art.name, description: art.description, unit: art.unit, billing: art.billing, quantity: qty, unitPrice: art.price, discount: lineDiscount, net });
  }
  if (!lines.length) throw Object.assign(new Error('Bitte mindestens eine Leistung auswählen'), { status: 400 });
  const monthlyNet = round2(lines.filter((l) => l.billing === 'monthly').reduce((s, l) => s + l.net, 0));
  const onceNet = round2(lines.filter((l) => l.billing === 'once').reduce((s, l) => s + l.net, 0));
  const vat = cat.vatPercent / 100;
  return {
    lines,
    termMonths: term,
    discount,
    totals: {
      monthlyNet, monthlyGross: round2(monthlyNet * (1 + vat)),
      onceNet, onceGross: round2(onceNet * (1 + vat)),
      contractNet: round2(monthlyNet * term + onceNet),
      vatPercent: cat.vatPercent,
    },
  };
}

// ---------- lokale Ablage ----------
const file = (id, ext) => path.join(dir, `${id}.${ext}`);
const save = (rec) => fs.writeFileSync(file(rec.id, 'json'), JSON.stringify(rec, null, 2));

export function history() {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.signedAt - a.signedAt)
    .slice(0, 50)
    .map(({ signature, ...r }) => r);
}

export function pdfPath(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  const f = file(id, 'pdf');
  return fs.existsSync(f) ? f : null;
}

function newId() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `SIT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function validSignature(sig) {
  return typeof sig === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) && sig.length > 2000 && sig.length < 1_500_000;
}

/** Vorschau-PDF (ohne Unterschrift) zum Zeigen vor dem Unterschreiben */
export async function previewPdf(token, input, session) {
  const calc = await calculate(token, input);
  const customer = input.customerId ? await customerContact(token, input.customerId).catch(() => null) : null;
  return renderOfferPdf({ id: 'ENTWURF', customer, ...calc, seller: session.name, note: input.note, preview: true });
}

/** Unterschreiben: lokal sichern, PDF erzeugen, in weclapp anlegen */
export async function signAndCreate(token, input, session) {
  if (!input.customerId) throw Object.assign(new Error('Bitte einen Kunden auswählen'), { status: 400 });
  const signerName = String(input.signerName || '').trim();
  if (signerName.length < 3) throw Object.assign(new Error('Bitte den Namen der unterschreibenden Person eintragen'), { status: 400 });
  if (!input.acceptedTerms) throw Object.assign(new Error('Bitte die Zustimmung zu den AGB bestätigen'), { status: 400 });
  if (!validSignature(input.signature)) throw Object.assign(new Error('Bitte unterschreiben'), { status: 400 });

  const calc = await calculate(token, input);
  const customer = await customerContact(token, input.customerId);
  const rec = {
    id: newId(),
    status: 'signed',
    signedAt: Date.now(),
    seller: { id: session.userId, name: session.name },
    customer,
    signer: { name: signerName, role: String(input.signerRole || '').trim(), email: String(input.signerEmail || '').trim() },
    note: String(input.note || '').slice(0, 2000),
    ...calc,
    signature: input.signature,
    weclapp: {},
    warnings: [],
  };
  // Prüfsumme über den Inhalt (Positionen, Summen, Kunde, Unterschrift)
  rec.hash = crypto.createHash('sha256').update(JSON.stringify({ c: rec.customer.id, l: rec.lines, t: rec.totals, s: rec.signer, at: rec.signedAt, sig: rec.signature })).digest('hex');
  save(rec);

  return pushToWeclapp(token, rec);
}

async function pushToWeclapp(token, rec) {
  const customer = rec.customer;
  rec.warnings = [];
  // 1) Angebot in weclapp anlegen
  try {
    const validTo = Date.now() + config.offerValidDays * 864e5;
    const term = `Laufzeit ${rec.termMonths} Monate`;
    const q = unwrap(await request(token, 'POST', '/quotation', {
      body: {
        customerId: String(customer.id),
        quotationDate: rec.signedAt,
        validTo,
        commission: `Angebotsboard ${rec.id}`,
        recordComment: `Vor Ort unterschrieben von ${rec.signer.name}${rec.signer.role ? ` (${rec.signer.role})` : ''} am ${new Date(rec.signedAt).toLocaleString('de-AT')} – erfasst von ${rec.seller.name} über das SIT-Cockpit (${rec.id}). ${term}.${rec.note ? ` Notiz: ${rec.note}` : ''}`,
        quotationItems: rec.lines.map((l, i) => ({
          articleId: l.articleId,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          manualUnitPrice: true,
          ...(l.discount ? { discountPercentage: String(l.discount) } : {}),
          positionNumber: i + 1,
          description: l.billing === 'monthly' ? `Monatliche Leistung, ${term}` : 'Einmalige Leistung',
        })),
      },
    }));
    rec.weclapp.quotationId = q.id;
    rec.weclapp.quotationNumber = q.quotationNumber;
  } catch (e) {
    rec.status = 'weclapp-failed';
    rec.warnings.push(`Angebot konnte nicht in weclapp angelegt werden: ${e.message}`);
  }

  // 2) PDF mit Angebotsnummer erzeugen und lokal ablegen
  const pdf = await renderOfferPdf({ ...rec, preview: false });
  fs.writeFileSync(file(rec.id, 'pdf'), pdf);
  const fileName = `${rec.weclapp.quotationNumber || rec.id}_Auftrag_unterschrieben.pdf`.replace(/[^\w.-]+/g, '_');

  if (rec.weclapp.quotationId) {
    // 3) PDF an das Angebot hängen
    await uploadDocument(token, { entityName: 'quotation', entityId: rec.weclapp.quotationId, fileName, contentType: 'application/pdf', data: pdf, description: `Unterschrieben von ${rec.signer.name}` })
      .catch((e) => rec.warnings.push(`PDF konnte nicht an das Angebot gehängt werden: ${e.message}`));
    // 4) Angebot annehmen (-> Auftrag) bzw. nur als angenommen markieren
    await acceptQuotation(token, rec, pdf, fileName)
      .catch((e) => rec.warnings.push(`Angebot wurde angelegt, aber nicht angenommen: ${e.message}`));
    rec.status = rec.warnings.length ? 'partial' : 'done';
  }
  save(rec);
  const { signature, ...out } = rec;
  return { ...out, pdfUrl: `/api/offer/${rec.id}/pdf` };
}

async function acceptQuotation(token, rec, pdf, fileName) {
  const id = rec.weclapp.quotationId;
  if (!config.offerCreateSalesOrder) {
    await request(token, 'POST', `/quotation/id/${id}/updateStatus`, { body: { status: 'ACCEPTED' } });
    return;
  }
  await request(token, 'POST', `/quotation/id/${id}/accept`, { body: { quotationType: 'SALES_ORDER' } });
  const [order] = await get(token, '/salesOrder', { 'quotationId-eq': id, properties: 'id,orderNumber', pageSize: 1 }).catch(() => []);
  if (order) {
    rec.weclapp.salesOrderId = order.id;
    rec.weclapp.salesOrderNumber = order.orderNumber;
    await uploadDocument(token, { entityName: 'salesOrder', entityId: order.id, fileName, contentType: 'application/pdf', data: pdf, description: `Unterschrieben von ${rec.signer.name}` })
      .catch((e) => rec.warnings.push(`PDF konnte nicht an den Auftrag gehängt werden: ${e.message}`));
  }
}

/** Fehlgeschlagene weclapp-Übertragung erneut versuchen (Unterschrift und Zeitpunkt bleiben original) */
export async function retry(token, id) {
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(file(id, 'json'))) throw Object.assign(new Error('Vorgang nicht gefunden'), { status: 404 });
  const rec = JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8'));
  if (rec.weclapp?.quotationId) throw Object.assign(new Error('Vorgang ist bereits in weclapp angelegt'), { status: 409 });
  rec.status = 'signed';
  return pushToWeclapp(token, rec);
}

export { WeclappError };
