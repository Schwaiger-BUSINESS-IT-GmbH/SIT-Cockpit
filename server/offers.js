// Angebotsboard (Basis: SIT_Angebotsboard_V4): Katalog + SLA-Modell aus
// config/angebotsboard.json, Berechnung am Server, Unterschrift -> PDF ->
// (ggf. Neukunde) -> Angebot in weclapp (angenommen) -> Auftrag.
// Jeder unterschriebene Vorgang wird ZUERST lokal gesichert.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { request, unwrap, uploadDocument } from './weclapp.js';
import { renderOfferPdf } from './pdf.js';

const dir = path.join(config.dataDir, 'offers');
const draftDir = path.join(dir, 'drafts');
fs.mkdirSync(draftDir, { recursive: true });

const get = (token, p, query) => request(token, 'GET', p, { query }).then(unwrap);
const count = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0);
const money = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n) * 100) / 100) : 0);
const r2 = (x) => Math.round(x * 100) / 100;
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

export function boardSettings() {
  return JSON.parse(fs.readFileSync(new URL('../config/angebotsboard.json', import.meta.url), 'utf8'));
}

// ---------- Katalog ----------
let skuCache = { at: 0, map: null };
async function articleIds(token, skus) {
  if (skuCache.map && Date.now() - skuCache.at < 300e3 && skus.every((s) => s in skuCache.map)) return skuCache.map;
  const map = {};
  for (let i = 0; i < skus.length; i += 50) {
    const rows = await get(token, '/article', { 'articleNumber-in': JSON.stringify(skus.slice(i, i + 50)), properties: 'id,articleNumber', pageSize: 100 });
    for (const a of rows) map[a.articleNumber] = String(a.id);
  }
  for (const s of skus) if (!(s in map)) map[s] = null;
  skuCache = { at: Date.now(), map };
  return map;
}

function allSkus(s) {
  return [
    ...s.products.map((p) => p.sku),
    ...Object.values(s.sla.skuBase), ...Object.values(s.sla.skuUser),
    s.sla.site.sku, s.sla.setup.sku, ...Object.values(s.sla.reviews).map((r) => r.sku), s.projectSku,
  ];
}

/** Alles, was das Board zum Anzeigen braucht, plus Abgleich mit weclapp */
export async function catalog(token) {
  const s = boardSettings();
  let missing = [];
  let weclappError = null;
  try {
    const map = await articleIds(token, allSkus(s));
    missing = Object.entries(map).filter(([, id]) => !id).map(([sku]) => sku);
  } catch (e) {
    weclappError = e.message;
  }
  return {
    company: s.company,
    groups: s.groups,
    products: s.products,
    sla: { labels: s.sla.labels, rates: s.sla.rates, site: s.sla.site.price, setup: s.sla.setup.price, reviews: Object.fromEntries(Object.entries(s.sla.reviews).map(([k, v]) => [k, v.price])), draft: !!s.sla.draft },
    vatPercent: s.vatPercent,
    onboardingChecks: s.onboardingChecks,
    offerNotesPreview: s.offerNotesPreview,
    termsUrl: config.termsUrl,
    missingInWeclapp: missing,
    weclappError,
  };
}

// ---------- Berechnung (identische Logik wie V4, aber am Server) ----------
export function calculate(input, s = boardSettings()) {
  const assets = Object.fromEntries(['users', 'clients', 'servers', 'firewalls', 'sites'].map((k) => [k, count(input.assets?.[k])]));
  const monthly = [], once = [];
  const sla = s.sla.rates[input.sla] ? input.sla : 'none';
  if (sla !== 'none') {
    const r = s.sla.rates[sla], label = s.sla.labels[sla];
    monthly.push({ sku: s.sla.skuBase[sla], name: `Service-Level ${label} – Grundgebühr`, qty: 1, unit: 'Monat', price: r.base, desc: `Vertragliche Erstreaktionsziele während der vereinbarten Servicezeiten, abgestuft nach Störungspriorität (P1 ${r.p1}, P2 ${r.p2}, P3 ${r.p3}, P4 ${r.p4}). Die Reaktionszeit ist keine garantierte Entstörungszeit.` });
    if (assets.users) monthly.push({ sku: s.sla.skuUser[sla], name: `Service-Level ${label} – Benutzer`, qty: assets.users, unit: 'User', price: r.user, desc: 'Benutzerabhängiger Anteil der Service-Level-Betreuung.' });
    if (assets.sites > 1) monthly.push({ sku: s.sla.site.sku, name: 'Zusätzlicher Standort', qty: assets.sites - 1, unit: 'Standort', price: s.sla.site.price, desc: 'Zuschlag je weiterem vereinbartem Betriebsstandort.' });
    const rev = s.sla.reviews[input.review];
    if (rev) monthly.push({ sku: rev.sku, name: rev.name, qty: 1, unit: 'Monat', price: rev.price, desc: rev.desc });
    if (input.setup !== false) once.push({ sku: s.sla.setup.sku, name: 'SLA-Einrichtung und Dokumentation', qty: 1, unit: 'einmalig', price: s.sla.setup.price, desc: 'Einmalige Standardkonfiguration und Dokumentation, bis zu 1,5 Stunden.' });
  }
  const chosen = [];
  for (const p of s.products) {
    const sel = (input.products || []).find((x) => x && x.id === p.id);
    const qty = count(sel?.qty);
    if (!sel || !sel.selected || !qty) continue;
    chosen.push({ ...p, qty });
    const price = p.threshold && qty >= p.threshold ? p.tier : p.price;
    const custom = str(sel.custom, 20000);
    monthly.push({ sku: p.sku, name: p.name, qty, unit: p.unit, price, group: p.group, tierActive: price !== p.price, desc: custom || `${p.scope}\n\nAbgrenzung / Voraussetzungen:\n${p.exclusions}` });
  }
  const proj = input.project || {};
  if (proj.enabled && str(proj.name)) once.push({ sku: s.projectSku, name: str(proj.name, 200), qty: 1, unit: 'einmalig', price: money(proj.price), desc: 'Einmalige zusätzliche Projektleistung gemäß separater Beschreibung.', project: true });

  const sum = (l) => r2(l.reduce((a, x) => a + x.price * x.qty, 0));
  const m = sum(monthly), o = sum(once), vat = s.vatPercent / 100;
  const totals = { monthly: m, once: o, arr: r2(m * 12), first: r2(m + o), vat: r2((m + o) * vat), gross: r2((m + o) * (1 + vat)), vatPercent: s.vatPercent };
  return { assets, sla, review: s.sla.reviews[input.review] ? input.review : 'none', monthly, once, totals, warnings: warnings(chosen, assets, sla, s) };
}

function warnings(chosen, assets, sla, s) {
  const out = [];
  const has = (id) => chosen.some((p) => p.id === id);
  if (has('clientpremium') && has('clientremote')) out.push('Managed Client Premium und Client-Flatrate: mögliche Überschneidung bei Remote-Management und Wartung prüfen.');
  if (has('serverpremium') && has('serverremote')) out.push('Managed Server Premium und Server-Flatrate: mögliche Leistungsüberschneidung prüfen.');
  if (has('clientremote') && chosen.some((p) => p.group === 'Security')) out.push('Die Client-Flatrate-PDF führt Endpoint-Security als enthaltene Leistung auf. Security-Pakete als Upgrade oder eigenständiges Produkt abgrenzen.');
  if (chosen.some((p) => !p.verified)) out.push('Professional/Node: eigene Leistungsbeschreibungen fehlen. Vor Angebotsfreigabe ergänzen.');
  if (chosen.some((p) => p.sourceCaveat)) out.push('Die allgemeine Managed-Client/Server-Beschreibung muss intern noch ausdrücklich den Premium-Artikeln zugeordnet werden.');
  const fw = chosen.filter((p) => p.group === 'Managed Firewall').reduce((a, p) => a + p.qty, 0);
  if (fw > assets.firewalls) out.push('Es wurden mehr Firewall-Servicepakete als angegebene Firewalls ausgewählt. Mengen prüfen.');
  if (chosen.some((p) => ['fwessential', 'fwbusiness', 'fwpremium', 'serverremote'].includes(p.id))) out.push('Die Firewall- und Server-Flatrate-PDFs nennen Freitag 08:00–17:00 Uhr; eure Website nennt Freitag 08:00–12:00 Uhr. Vertragszeiten vor Zusage harmonisieren.');
  if (sla !== 'none') out.push('Neues Zusatz-SLA und bestehende produktspezifische Reaktionsfristen können abweichen. Vertragliche Vorrangregelung erforderlich.');
  if (sla !== 'none' && s.sla.draft) out.push('Die Zusatz-SLA-Preise sind noch Entwurfswerte und nicht freigegeben.');
  return out;
}

function customerOf(input) {
  const c = input.customer || {};
  return { id: c.id ? String(c.id) : null, number: str(c.number, 50), company: str(c.company, 200), contact: str(c.contact, 200), mail: str(c.mail, 200), phone: str(c.phone, 100), place: str(c.place, 200) };
}

function internalOf(input) {
  const i = input.internal || {};
  const ratings = {};
  for (const k of ['margin', 'support', 'loyalty', 'strategy', 'cooperation']) ratings[k] = Math.min(5, Math.max(1, count(i.ratings?.[k]) || 3));
  return { category: ['Gold', 'Silber', 'Bronze', 'Registered'].includes(i.category) ? i.category : 'Silber', ratings, reason: str(i.reason, 3000) };
}

// ---------- Entwürfe ("Kundenstand speichern") ----------
const draftFile = (id) => path.join(draftDir, `${id}.json`);
const validId = (id) => /^[\w-]{6,64}$/.test(String(id || ''));

export function saveDraft(input, session) {
  const id = validId(input.draftId) ? input.draftId : `D-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const { draftId, ...state } = input;
  const rec = { id, updatedAt: Date.now(), user: session.name, company: str(state.customer?.company, 200) || 'Neukunde', monthly: calculate(state).totals.monthly, state };
  fs.writeFileSync(draftFile(id), JSON.stringify(rec));
  return { id, updatedAt: rec.updatedAt };
}
export function listDrafts() {
  return fs.readdirSync(draftDir).filter((f) => f.endsWith('.json'))
    .map((f) => { try { const { state, ...r } = JSON.parse(fs.readFileSync(path.join(draftDir, f), 'utf8')); return r; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}
export function getDraft(id) {
  if (!validId(id) || !fs.existsSync(draftFile(id))) throw bad('Entwurf nicht gefunden', 404);
  return JSON.parse(fs.readFileSync(draftFile(id), 'utf8'));
}
export function deleteDraft(id) {
  if (validId(id) && fs.existsSync(draftFile(id))) fs.unlinkSync(draftFile(id));
}

// ---------- unterschriebene Vorgänge ----------
const file = (id, ext) => path.join(dir, `${id}.${ext}`);
const save = (rec) => fs.writeFileSync(file(rec.id, 'json'), JSON.stringify(rec, null, 2));
const load = (id) => {
  if (!/^SIT-[\w-]+$/.test(id) || !fs.existsSync(file(id, 'json'))) throw bad('Vorgang nicht gefunden', 404);
  return JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8'));
};
const publicRec = ({ signature, ...r }) => ({ ...r, pdfUrl: `/api/offer/${r.id}/pdf` });

export function history() {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return publicRec(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.signedAt - a.signedAt).slice(0, 50);
}
export const getOffer = (id) => publicRec(load(id));

export function pdfPath(id) {
  if (!/^SIT-[\w-]+$/.test(id)) return null;
  const f = file(id, 'pdf');
  return fs.existsSync(f) ? f : null;
}

export function saveOnboarding(id, checks) {
  const rec = load(id);
  const n = boardSettings().onboardingChecks.length;
  rec.onboarding = Array.from({ length: n }, (_, i) => Boolean(checks?.[i]));
  rec.onboardingUpdatedAt = Date.now();
  save(rec);
  return publicRec(rec);
}

function newId() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `SIT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
const validSignature = (sig) => typeof sig === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) && sig.length > 2000 && sig.length < 1_500_000;

/** Vorschau-PDF (ohne Unterschrift) */
export async function previewPdf(input, session) {
  const calc = calculate(input);
  return renderOfferPdf({ id: 'ENTWURF', preview: true, customer: customerOf(input), seller: { name: session.name }, notes: str(input.notes, 3000), includeDetails: input.includeDetails !== false, ...calc });
}

/** Unterschreiben: lokal sichern, dann weclapp */
export async function signAndCreate(token, input, session) {
  const customer = customerOf(input);
  if (!customer.id && customer.company.length < 2) throw bad('Bitte den Kunden angeben (weclapp-Kunde wählen oder Unternehmen eintragen)');
  const calc = calculate(input);
  if (!calc.monthly.length && !calc.once.length) throw bad('Bitte mindestens eine Leistung auswählen');
  if (calc.warnings.length && !input.ready) throw bad('Es gibt offene Prüfpunkte. Bitte intern prüfen und „Intern geprüft“ bestätigen.');
  const signerName = str(input.signerName, 200);
  if (signerName.length < 3) throw bad('Bitte den Namen der unterschreibenden Person eintragen');
  if (!input.acceptedTerms) throw bad('Bitte die Beauftragung bestätigen');
  if (!validSignature(input.signature)) throw bad('Bitte unterschreiben');

  const rec = {
    id: newId(),
    status: 'signed',
    signedAt: Date.now(),
    seller: { id: session.userId, name: session.name },
    customer,
    intakeNotes: str(input.intakeNotes, 3000),
    internal: internalOf(input), // nur intern, nicht im PDF
    notes: str(input.notes, 3000),
    includeDetails: input.includeDetails !== false,
    signer: { name: signerName, role: str(input.signerRole, 200), email: str(input.signerEmail, 200) },
    ...calc,
    onboarding: boardSettings().onboardingChecks.map((_, i) => i === 3), // "Vertrag unterschrieben" ist erledigt
    signature: input.signature,
    weclapp: {},
    warningsWeclapp: [],
  };
  rec.hash = crypto.createHash('sha256').update(JSON.stringify({ c: rec.customer, m: rec.monthly, o: rec.once, t: rec.totals, s: rec.signer, at: rec.signedAt, sig: rec.signature })).digest('hex');
  save(rec);
  return pushToWeclapp(token, rec);
}

async function pushToWeclapp(token, rec) {
  rec.warningsWeclapp = [];
  const s = boardSettings();
  // 1) Kunde: vorhandenen nutzen oder neu anlegen
  if (!rec.customer.id) {
    try {
      const p = unwrap(await request(token, 'POST', '/party', {
        body: { partyType: 'ORGANIZATION', company: rec.customer.company, customer: true, ...(rec.customer.mail ? { email: rec.customer.mail } : {}), ...(rec.customer.phone ? { phone: rec.customer.phone } : {}) },
      }));
      rec.customer.id = String(p.id);
      rec.customer.number = p.customerNumber || '';
      rec.weclapp.partyCreated = true;
    } catch (e) {
      rec.status = 'weclapp-failed';
      rec.warningsWeclapp.push(`Neukunde konnte nicht in weclapp angelegt werden: ${e.message}`);
    }
  }
  // 2) Angebot anlegen
  if (rec.customer.id) {
    try {
      const lines = [...rec.monthly, ...rec.once];
      const ids = await articleIds(token, allSkus(s).concat(lines.map((l) => l.sku)));
      const missing = [...new Set(lines.filter((l) => !ids[l.sku]).map((l) => l.sku))];
      if (missing.length) throw new Error(`Artikel fehlen in weclapp: ${missing.join(', ')}`);
      const toHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
      const q = unwrap(await request(token, 'POST', '/quotation', {
        body: {
          customerId: rec.customer.id,
          quotationDate: rec.signedAt,
          validTo: rec.signedAt + config.offerValidDays * 864e5,
          commission: `Angebotsboard ${rec.id}`,
          recordComment: `Vor Ort unterschrieben von ${rec.signer.name}${rec.signer.role ? ` (${rec.signer.role})` : ''} am ${new Date(rec.signedAt).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })} – erfasst von ${rec.seller.name} über das SIT-Cockpit (${rec.id}).${rec.customer.contact ? ` Ansprechpartner: ${rec.customer.contact}.` : ''}${rec.notes ? ` Anmerkung: ${rec.notes}` : ''}`,
          quotationItems: lines.map((l, i) => ({
            articleId: ids[l.sku],
            quantity: String(l.qty),
            unitPrice: String(l.price),
            manualUnitPrice: true,
            positionNumber: i + 1,
            ...(l.project ? { title: l.name } : {}),
            description: toHtml(`${i < rec.monthly.length ? 'Monatlich wiederkehrend' : 'Einmalig'}${rec.includeDetails ? `\n${l.desc}` : ''}`),
          })),
        },
      }));
      rec.weclapp.quotationId = String(q.id);
      rec.weclapp.quotationNumber = q.quotationNumber;
    } catch (e) {
      rec.status = 'weclapp-failed';
      rec.warningsWeclapp.push(`Angebot konnte nicht in weclapp angelegt werden: ${e.message}`);
    }
  }
  // 3) PDF (mit Angebotsnummer, falls vorhanden) lokal ablegen
  const pdf = await renderOfferPdf({ ...rec, preview: false });
  fs.writeFileSync(file(rec.id, 'pdf'), pdf);
  // 4) PDF anhängen, annehmen -> Auftrag
  if (rec.weclapp.quotationId) {
    const fileName = `${rec.weclapp.quotationNumber || rec.id}_Auftrag_unterschrieben.pdf`.replace(/[^\w.-]+/g, '_');
    const desc = `Unterschrieben von ${rec.signer.name}`;
    await uploadDocument(token, { entityName: 'quotation', entityId: rec.weclapp.quotationId, fileName, contentType: 'application/pdf', data: pdf, description: desc })
      .catch((e) => rec.warningsWeclapp.push(`PDF konnte nicht an das Angebot gehängt werden: ${e.message}`));
    try {
      if (config.offerCreateSalesOrder) {
        await request(token, 'POST', `/quotation/id/${rec.weclapp.quotationId}/accept`, { body: { quotationType: 'SALES_ORDER' } });
        const [order] = await get(token, '/salesOrder', { 'quotationId-eq': rec.weclapp.quotationId, properties: 'id,orderNumber', pageSize: 1 }).catch(() => []);
        if (order) {
          rec.weclapp.salesOrderId = String(order.id);
          rec.weclapp.salesOrderNumber = order.orderNumber;
          await uploadDocument(token, { entityName: 'salesOrder', entityId: order.id, fileName, contentType: 'application/pdf', data: pdf, description: desc })
            .catch((e) => rec.warningsWeclapp.push(`PDF konnte nicht an den Auftrag gehängt werden: ${e.message}`));
        }
      } else {
        await request(token, 'POST', `/quotation/id/${rec.weclapp.quotationId}/updateStatus`, { body: { status: 'ACCEPTED' } });
      }
    } catch (e) {
      rec.warningsWeclapp.push(`Angebot wurde angelegt, aber nicht angenommen: ${e.message}`);
    }
    rec.status = rec.warningsWeclapp.length ? 'partial' : 'done';
  }
  save(rec);
  return publicRec(rec);
}

/** Fehlgeschlagene weclapp-Übertragung erneut versuchen (Unterschrift und Zeitpunkt bleiben original) */
export async function retry(token, id) {
  const rec = load(id);
  if (rec.weclapp?.quotationId) throw bad('Vorgang ist bereits in weclapp angelegt', 409);
  skuCache = { at: 0, map: null }; // evtl. inzwischen angelegte Artikel finden
  return pushToWeclapp(token, rec);
}
