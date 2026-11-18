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

const DE_TEXTS = {
  slaBase: 'Service-Level {label} – Grundgebühr',
  slaBaseDesc: 'Vertragliche Erstreaktionsziele während der vereinbarten Servicezeiten, abgestuft nach Störungspriorität (P1 {p1}, P2 {p2}, P3 {p3}, P4 {p4}). Die Reaktionszeit ist keine garantierte Entstörungszeit.',
  slaUser: 'Service-Level {label} – Benutzer',
  slaUserDesc: 'Benutzerabhängiger Anteil der Service-Level-Betreuung.',
  site: 'Zusätzlicher Standort',
  siteDesc: 'Zuschlag je weiterem vereinbartem Betriebsstandort.',
  setup: 'SLA-Einrichtung und Dokumentation',
  setupDesc: 'Einmalige Standardkonfiguration und Dokumentation, bis zu 1,5 Stunden.',
  projectDesc: 'Einmalige zusätzliche Projektleistung gemäß separater Beschreibung.',
  exclusionsLabel: 'Abgrenzung / Voraussetzungen',
  units: {},
  monthlyLine: 'Monatlich wiederkehrend',
  onceLine: 'Einmalig',
};
export const LANGS = ['de', 'en'];
export const langOf = (v) => (LANGS.includes(v) ? v : 'de');
const fillT = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Einstellungen des Boards; für "en" mit den Texten aus angebotsboard.en.json (Preise bleiben gleich) */
export function boardSettings(lang = 'de') {
  const s = JSON.parse(fs.readFileSync(new URL('../config/angebotsboard.json', import.meta.url), 'utf8'));
  s.lang = langOf(lang);
  s.texts = { ...DE_TEXTS };
  s.groupLabels = Object.fromEntries(s.groups.map((g) => [g, g]));
  if (s.lang === 'de') return s;
  let t = {};
  try { t = JSON.parse(fs.readFileSync(new URL(`../config/angebotsboard.${s.lang}.json`, import.meta.url), 'utf8')); } catch { return s; }
  if (t.company) s.company = { ...s.company, ...t.company };
  if (t.groupLabels) s.groupLabels = { ...s.groupLabels, ...t.groupLabels };
  s.products = s.products.map((p) => ({ ...p, ...(t.products?.[p.id] || {}) }));
  if (t.sla?.labels) s.sla.labels = { ...s.sla.labels, ...t.sla.labels };
  for (const [k, times] of Object.entries(t.sla?.times || {})) if (s.sla.rates[k]) s.sla.rates[k] = { ...s.sla.rates[k], ...times };
  for (const [k, rv] of Object.entries(t.sla?.reviews || {})) if (s.sla.reviews[k]) s.sla.reviews[k] = { ...s.sla.reviews[k], ...rv };
  if (t.texts) s.texts = { ...s.texts, ...t.texts, units: { ...(t.texts.units || {}) } };
  for (const k of ['offerNotesPreview', 'offerNotesSigned']) if (t[k]) s[k] = t[k];
  return s;
}

// ---------- Artikelzuordnung Board-Position -> weclapp-Artikel ----------
// Die Artikelnummern in config/angebotsboard.json sind Board-interne Kennungen.
// Welcher echte weclapp-Artikel dahintersteht, wird im Board unter
// "Artikelzuordnung" festgelegt und in DATA_DIR/article-map.json gespeichert.
// Ohne Zuordnung wird ein weclapp-Artikel mit gleicher Artikelnummer gesucht.
const mapFile = path.join(config.dataDir, 'article-map.json');
const loadMap = () => { try { return JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { return {}; } };
const saveMap = (m) => fs.writeFileSync(mapFile, JSON.stringify(m, null, 2));

/** Alle Board-Positionen, die einen weclapp-Artikel brauchen */
export function positions(s = boardSettings('de')) {
  const out = s.products.map((p) => ({ sku: p.sku, label: p.name, group: p.group, price: p.price, unit: p.unit }));
  for (const k of Object.keys(s.sla.rates)) {
    out.push({ sku: s.sla.skuBase[k], label: `Service-Level ${s.sla.labels[k]} – Grundgebühr`, group: 'Zusatz-SLA', price: s.sla.rates[k].base, unit: 'Monat' });
    out.push({ sku: s.sla.skuUser[k], label: `Service-Level ${s.sla.labels[k]} – Benutzer`, group: 'Zusatz-SLA', price: s.sla.rates[k].user, unit: 'User' });
  }
  out.push({ sku: s.sla.site.sku, label: 'Zusätzlicher Standort (SLA)', group: 'Zusatz-SLA', price: s.sla.site.price, unit: 'Standort' });
  out.push({ sku: s.sla.setup.sku, label: 'SLA-Einrichtung und Dokumentation', group: 'Zusatz-SLA', price: s.sla.setup.price, unit: 'einmalig' });
  for (const r of Object.values(s.sla.reviews)) out.push({ sku: r.sku, label: r.name, group: 'Zusatz-SLA', price: r.price, unit: 'Monat' });
  out.push({ sku: s.projectSku, label: 'Projektposition (Name und Preis frei)', group: 'Sonstiges', price: null, unit: 'einmalig' });
  return out;
}

function pickPrice(article, now = Date.now()) {
  const prices = (article.articlePrices || []).filter((p) => !p.customerId && (!p.salesChannel || p.salesChannel === 'NET1')
    && (!p.startDate || Number(p.startDate) <= now) && (!p.endDate || Number(p.endDate) >= now));
  prices.sort((a, b) => Number(a.priceScaleValue || 0) - Number(b.priceScaleValue || 0));
  return prices.length ? Number(prices[0].price) : null;
}
const ARTICLE_PROPS = 'id,articleNumber,name,active,articlePrices';
const shortArticle = (a) => ({ id: String(a.id), number: a.articleNumber, name: a.name, active: a.active !== false, price: pickPrice(a) });

let resolveCache = { at: 0, map: null };
/** sku -> { id, number } | null (Zuordnung zuerst, sonst gleiche Artikelnummer) */
async function resolveArticles(token, skus) {
  if (resolveCache.map && Date.now() - resolveCache.at < 300e3 && skus.every((s) => s in resolveCache.map)) return resolveCache.map;
  const mapping = loadMap();
  const map = {};
  for (const s of skus) if (mapping[s]?.id) map[s] = { id: mapping[s].id, number: mapping[s].number };
  const rest = skus.filter((s) => !map[s]);
  for (let i = 0; i < rest.length; i += 50) {
    const rows = await get(token, '/article', { 'articleNumber-in': JSON.stringify(rest.slice(i, i + 50)), properties: 'id,articleNumber', pageSize: 100 });
    for (const a of rows) map[a.articleNumber] = { id: String(a.id), number: a.articleNumber };
  }
  for (const s of skus) if (!(s in map)) map[s] = null;
  resolveCache = { at: Date.now(), map };
  return map;
}

/** Übersicht für die Zuordnungsseite inkl. Preisabgleich */
export async function articleMapping(token) {
  const pos = positions();
  const resolved = await resolveArticles(token, pos.map((p) => p.sku));
  const mapping = loadMap();
  const ids = [...new Set(Object.values(resolved).filter(Boolean).map((r) => r.id))];
  const details = {};
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await get(token, '/article', { 'id-in': JSON.stringify(ids.slice(i, i + 50)), properties: ARTICLE_PROPS, pageSize: 100 });
    for (const a of rows) details[String(a.id)] = shortArticle(a);
  }
  return pos.map((p) => {
    const r = resolved[p.sku];
    const art = r ? details[r.id] || { id: r.id, number: r.number, name: '(nicht mehr lesbar)', active: false, price: null } : null;
    const deviation = art && p.price != null && art.price != null && Math.abs(art.price - p.price) > 0.004 ? Math.round((art.price - p.price) * 100) / 100 : null;
    return { ...p, status: !art ? 'missing' : mapping[p.sku] ? 'mapped' : 'direct', article: art, deviation, mappedBy: mapping[p.sku]?.by || null, mappedAt: mapping[p.sku]?.at || null };
  });
}

export async function searchArticles(token, q) {
  const term = str(q, 100);
  if (term.length < 2) return [];
  const base = { properties: ARTICLE_PROPS, pageSize: 15, 'active-eq': true };
  const [byName, byNumber] = await Promise.all([
    get(token, '/article', { ...base, 'name-ilike': `%${term}%` }).catch(() => []),
    get(token, '/article', { ...base, 'articleNumber-ilike': `%${term}%` }).catch(() => []),
  ]);
  const seen = new Set();
  return [...byNumber, ...byName].filter((a) => (seen.has(a.id) ? false : seen.add(a.id))).slice(0, 20).map(shortArticle);
}

const STOP = new Set(['sit', 'und', 'der', 'die', 'das', 'mit', 'für', 'edition', 'service', 'level']);
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

/** Vorschläge für noch nicht zugeordnete Positionen (Namensähnlichkeit) */
export async function suggestArticles(token) {
  const list = await articleMapping(token);
  const out = {};
  for (const p of list.filter((x) => x.status === 'missing')) {
    const w = words(p.label);
    if (!w.length) continue;
    // mit den zwei längsten Wörtern suchen, Treffer nach Wortüberschneidung bewerten
    const keys = [...w].sort((a, b) => b.length - a.length).slice(0, 2);
    const cands = [];
    for (const key of keys) cands.push(...await get(token, '/article', { properties: ARTICLE_PROPS, pageSize: 30, 'active-eq': true, 'name-ilike': `%${key}%` }).catch(() => []));
    let best = null;
    for (const a of cands) {
      const aw = new Set(words(a.name));
      const hit = w.filter((x) => aw.has(x)).length;
      const score = hit / Math.max(w.length, aw.size);
      if (!best || score > best.score) best = { score, article: shortArticle(a) };
    }
    if (best && best.score >= 0.5) out[p.sku] = { ...best.article, score: Math.round(best.score * 100) };
  }
  return out;
}

export async function setArticleMapping(token, sku, articleId, session) {
  if (!positions().some((p) => p.sku === sku)) throw bad('Unbekannte Board-Position', 404);
  const m = loadMap();
  if (!articleId) delete m[sku];
  else {
    const a = unwrap(await request(token, 'GET', `/article/id/${encodeURIComponent(articleId)}`, { query: { properties: 'id,articleNumber,name' } }));
    if (!a?.id) throw bad('Artikel nicht gefunden', 404);
    m[sku] = { id: String(a.id), number: a.articleNumber, name: a.name, by: session.name, at: Date.now() };
  }
  saveMap(m);
  resolveCache = { at: 0, map: null };
  return articleMapping(token);
}

// ---------- Katalog ----------
/** Alles, was das Board zum Anzeigen braucht, plus Abgleich mit weclapp */
export async function catalog(token, lang) {
  const s = boardSettings(lang);
  let missing = [];
  let weclappError = null;
  try {
    const map = await resolveArticles(token, positions(s).map((p) => p.sku));
    missing = Object.entries(map).filter(([, v]) => !v).map(([sku]) => sku);
  } catch (e) {
    weclappError = e.message;
  }
  return {
    lang: s.lang,
    company: s.company,
    groups: s.groups,
    groupLabels: s.groupLabels,
    texts: s.texts,
    products: s.products,
    sla: { labels: s.sla.labels, rates: s.sla.rates, site: s.sla.site.price, setup: s.sla.setup.price, reviews: Object.fromEntries(Object.entries(s.sla.reviews).map(([k, v]) => [k, v.price])), reviewTexts: Object.fromEntries(Object.entries(s.sla.reviews).map(([k, v]) => [k, { name: v.name, desc: v.desc }])), draft: !!s.sla.draft },
    vatPercent: s.vatPercent,
    onboardingChecks: s.onboardingChecks,
    offerNotesPreview: s.offerNotesPreview,
    termsUrl: config.termsUrl,
    missingInWeclapp: missing,
    weclappError,
  };
}

// ---------- Berechnung (identische Logik wie V4, aber am Server) ----------
/** Berechnung + Prüfpunkt für Positionen ohne weclapp-Artikel (braucht weclapp-Zugriff) */
export async function calculateChecked(token, input) {
  const calc = calculate(input);
  try {
    const lines = [...calc.monthly, ...calc.once];
    const ids = await resolveArticles(token, [...new Set(lines.map((l) => l.sku))]);
    const open = [...new Set(lines.filter((l) => !ids[l.sku]).map((l) => (l.project ? 'Projektposition' : l.name)))];
    if (open.length) calc.warnings.push(`Noch kein weclapp-Artikel für: ${open.join(', ')}. Die Unterschrift wird gespeichert, das Angebot kann aber erst nach der Artikelzuordnung in weclapp angelegt werden (dann „Erneut an weclapp senden“).`);
  } catch { /* weclapp nicht erreichbar – Prüfung beim Anlegen */ }
  return calc;
}

export function calculate(input, s = boardSettings(input?.lang)) {
  const assets = Object.fromEntries(['users', 'clients', 'servers', 'firewalls', 'sites'].map((k) => [k, count(input.assets?.[k])]));
  const monthly = [], once = [];
  const sla = s.sla.rates[input.sla] ? input.sla : 'none';
  if (sla !== 'none') {
    const r = s.sla.rates[sla], label = s.sla.labels[sla], T = s.texts;
    const U = (u) => T.units?.[u] || u;
    monthly.push({ sku: s.sla.skuBase[sla], name: fillT(T.slaBase, { label }), qty: 1, unit: U('Monat'), price: r.base, desc: fillT(T.slaBaseDesc, r) });
    if (assets.users) monthly.push({ sku: s.sla.skuUser[sla], name: fillT(T.slaUser, { label }), qty: assets.users, unit: U('User'), price: r.user, desc: T.slaUserDesc });
    if (assets.sites > 1) monthly.push({ sku: s.sla.site.sku, name: T.site, qty: assets.sites - 1, unit: U('Standort'), price: s.sla.site.price, desc: T.siteDesc });
    const rev = s.sla.reviews[input.review];
    if (rev) monthly.push({ sku: rev.sku, name: rev.name, qty: 1, unit: U('Monat'), price: rev.price, desc: rev.desc });
    if (input.setup !== false) once.push({ sku: s.sla.setup.sku, name: T.setup, qty: 1, unit: U('einmalig'), price: s.sla.setup.price, desc: T.setupDesc });
  }
  const chosen = [];
  for (const p of s.products) {
    const sel = (input.products || []).find((x) => x && x.id === p.id);
    const qty = count(sel?.qty);
    if (!sel || !sel.selected || !qty) continue;
    chosen.push({ ...p, qty });
    const price = p.threshold && qty >= p.threshold ? p.tier : p.price;
    const custom = str(sel.custom, 20000);
    monthly.push({ sku: p.sku, name: p.name, qty, unit: p.unit, price, group: p.group, tierActive: price !== p.price, desc: custom || `${p.scope}\n\n${s.texts.exclusionsLabel}:\n${p.exclusions}` });
  }
  const proj = input.project || {};
  if (proj.enabled && str(proj.name)) once.push({ sku: s.projectSku, name: str(proj.name, 200), qty: 1, unit: s.texts.units?.einmalig || 'einmalig', price: money(proj.price), desc: s.texts.projectDesc, project: true });

  const sum = (l) => r2(l.reduce((a, x) => a + x.price * x.qty, 0));
  const m = sum(monthly), o = sum(once), vat = s.vatPercent / 100;
  const totals = { monthly: m, once: o, arr: r2(m * 12), first: r2(m + o), vat: r2((m + o) * vat), gross: r2((m + o) * (1 + vat)), vatPercent: s.vatPercent };
  return { lang: s.lang, assets, sla, review: s.sla.reviews[input.review] ? input.review : 'none', monthly, once, totals, warnings: warnings(chosen, assets, sla, s) };
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
  const calc = await calculateChecked(token, input);
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
      const ids = await resolveArticles(token, [...new Set(lines.map((l) => l.sku))]);
      const missing = [...new Set(lines.filter((l) => !ids[l.sku]).map((l) => l.sku))];
      if (missing.length) throw new Error(`Keinem weclapp-Artikel zugeordnet: ${missing.join(', ')} (Angebotsboard → Artikelzuordnung)`);
      for (const l of lines) l.articleNumber = ids[l.sku].number; // echte Nummer fürs PDF
      const T = boardSettings(rec.lang).texts;
      const toHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
      const q = unwrap(await request(token, 'POST', '/quotation', {
        body: {
          customerId: rec.customer.id,
          quotationDate: rec.signedAt,
          validTo: rec.signedAt + config.offerValidDays * 864e5,
          commission: `Angebotsboard ${rec.id}`,
          recordComment: `Vor Ort unterschrieben von ${rec.signer.name}${rec.signer.role ? ` (${rec.signer.role})` : ''} am ${new Date(rec.signedAt).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })} – erfasst von ${rec.seller.name} über das SIT-Cockpit (${rec.id}).${rec.customer.contact ? ` Ansprechpartner: ${rec.customer.contact}.` : ''}${rec.notes ? ` Anmerkung: ${rec.notes}` : ''}`,
          quotationItems: lines.map((l, i) => ({
            articleId: ids[l.sku].id,
            quantity: String(l.qty),
            unitPrice: String(l.price),
            manualUnitPrice: true,
            positionNumber: i + 1,
            ...(l.project ? { title: l.name } : {}),
            description: toHtml(`${i < rec.monthly.length ? T.monthlyLine : T.onceLine}${rec.includeDetails ? `\n${l.desc}` : ''}`),
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
  resolveCache = { at: 0, map: null }; // evtl. inzwischen zugeordnete Artikel finden
  return pushToWeclapp(token, rec);
}
