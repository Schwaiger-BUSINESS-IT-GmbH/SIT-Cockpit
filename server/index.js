import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as wc from './weclapp.js';
import * as atera from './atera.js';
import * as sales from './sales.js';
import * as offers from './offers.js';
import { registerTimeRoutes } from './time-routes.js';
import { getStored, saveStored, removeStored } from './tokens.js';
import { setSession, clearSession, requireSession, entraPrincipal, requireEntraIfConfigured } from './session.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION, demo: config.demo }));

// Demo-Modus: Atera- und weclapp-Mock laufen im selben Prozess
if (config.demo) {
  const { weclappMock } = await import('./mock/weclapp.js');
  const { ateraMock } = await import('./mock/atera.js');
  app.use('/__mock/weclapp', weclappMock());
  app.use('/__mock/atera/api/v3', ateraMock());
}

app.use(requireEntraIfConfigured);
// Unterschrift (PNG als Data-URL) braucht etwas mehr Platz
app.use(express.json({ limit: '2mb' }));

// Sicherheits-Header
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Async-Handler mit einheitlicher Fehlerbehandlung
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const status = e instanceof wc.WeclappError
      ? (e.status === 401 || e.status === 403 ? e.status : 502)
      : e.status || 500;
    if (status >= 500) console.error(e);
    if (e instanceof wc.WeclappError && e.status === 401 && req.session) {
      removeStored(req.session.entraId);
      clearSession(res);
    }
    res.status(status).json({ error: e.message || 'Unbekannter Fehler', details: e.body });
  });

// ---------- Anmeldung (persönlicher weclapp-Token, wie SIT-Time) ----------
app.post('/api/login', h(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Bitte API-Token eingeben' });
  let user;
  try {
    user = await wc.currentUser(token);
  } catch (e) {
    return res.status(401).json({ error: 'Token ungültig oder weclapp nicht erreichbar', details: e.message });
  }
  const data = { token, userId: user.id, name: user.name, email: user.email, entraId: entraPrincipal(req)?.id };
  setSession(res, data);
  saveStored(data.entraId, data);
  res.json({ user, remembered: !!data.entraId });
}));

app.delete('/api/token', (req, res) => {
  removeStored(entraPrincipal(req)?.id);
  clearSession(res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true, logoutUrl: entraPrincipal(req) ? '/.auth/logout?post_logout_redirect_uri=/' : null });
});

const api = express.Router();
api.use(requireSession);

api.get('/me', (req, res) => {
  const { userId, name, email } = req.session;
  res.json({
    user: { id: userId, name, email },
    entra: entraPrincipal(req),
    settings: { roundMinutes: config.roundMinutes },
    tokenStored: !!getStored(req.session.entraId),
    version: VERSION,
    demo: config.demo,
    links: { weclapp: config.weclappWebUrl, atera: config.ateraWebUrl, terms: config.termsUrl },
  });
});

// ---------- Atera ----------
api.get('/atera/overview', h(async (req, res) => {
  const c = await atera.overview({ force: req.query.refresh === '1' });
  const customers = (c.customers || []).map(({ devices, ...rest }) => rest);
  res.json({ updatedAt: c.at, error: c.error, customers });
}));

api.get('/atera/customers/:id', h(async (req, res) => {
  const c = await atera.overview();
  const customer = (c.customers || []).find((x) => String(x.id) === String(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Kunde in Atera nicht gefunden' });
  // Zugehörigen weclapp-Kunden suchen (Kundennummer aus Atera-Feld, sonst Name)
  const number = await atera.customerNumber(customer.id);
  const party = await sales.findParty(req.session.token, { number, name: customer.name }).catch(() => null);
  const weclapp = party ? await sales.customerFacts(req.session.token, party.id).catch((e) => ({ error: e.message })) : null;
  res.json({ updatedAt: c.at, customer, party, weclapp });
}));

// ---------- weclapp-Dashboard ----------
api.get('/dashboard', h(async (req, res) => {
  res.json(await sales.dashboard(req.session.token, { userId: req.session.userId }));
}));

// ---------- Angebotsboard ----------
api.get('/offer/catalog', h(async (req, res) => res.json(await offers.catalog(req.session.token, req.query.lang))));
api.get('/offer/customers', h(async (req, res) => res.json({ customers: await sales.searchCustomers(req.session.token, req.query.q) })));
api.get('/offer/customers/:id', h(async (req, res) => res.json(await sales.customerContact(req.session.token, req.params.id))));
api.post('/offer/calculate', h(async (req, res) => res.json(await offers.calculateChecked(req.session.token, req.body || {}))));
api.post('/offer/preview', h(async (req, res) => {
  const pdf = await offers.previewPdf(req.body || {}, req.session);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${req.body?.lang === 'en' ? 'Offer_Draft' : 'Angebot_Entwurf'}.pdf"`);
  res.send(pdf);
}));
api.post('/offer/sign', h(async (req, res) => res.json(await offers.signAndCreate(req.session.token, req.body || {}, req.session))));
api.get('/offer/articles', h(async (req, res) => res.json({ positions: await offers.articleMapping(req.session.token) })));
api.get('/offer/articles/search', h(async (req, res) => res.json({ articles: await offers.searchArticles(req.session.token, req.query.q) })));
api.post('/offer/articles/suggest', h(async (req, res) => res.json({ suggestions: await offers.suggestArticles(req.session.token) })));
api.put('/offer/articles/:sku', h(async (req, res) => res.json({ positions: await offers.setArticleMapping(req.session.token, req.params.sku, req.body?.articleId || null, req.session) })));
api.get('/offer/drafts', h(async (req, res) => res.json({ drafts: offers.listDrafts() })));
api.post('/offer/drafts', h(async (req, res) => res.json(offers.saveDraft(req.body || {}, req.session))));
api.get('/offer/drafts/:id', h(async (req, res) => res.json(offers.getDraft(req.params.id))));
api.delete('/offer/drafts/:id', h(async (req, res) => { offers.deleteDraft(req.params.id); res.json({ ok: true }); }));
api.get('/offer/history', h(async (req, res) => res.json({ offers: offers.history() })));
api.get('/offer/:id', h(async (req, res) => res.json(offers.getOffer(req.params.id))));
api.put('/offer/:id/onboarding', h(async (req, res) => res.json(offers.saveOnboarding(req.params.id, req.body?.checks))));
api.post('/offer/:id/retry', h(async (req, res) => res.json(await offers.retry(req.session.token, req.params.id))));
api.get('/offer/:id/pdf', h(async (req, res) => {
  const file = offers.pdfPath(req.params.id);
  if (!file) return res.status(404).json({ error: 'PDF nicht gefunden' });
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${req.params.id}.pdf"`);
  res.sendFile(file);
}));

// ---------- SIT-Time (Zeiten) ----------
registerTimeRoutes(api, h);

app.use('/api', api);

// ---------- Frontend ----------
const pub = fileURLToPath(new URL('../public/', import.meta.url));
app.use(express.static(pub, {
  setHeaders(res, file) {
    if (/sw\.js$|index\.html$|\.webmanifest$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/zeiten/*', (req, res) => res.sendFile('zeiten/index.html', { root: pub }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Nicht gefunden' });
  res.sendFile('index.html', { root: pub });
});

app.listen(config.port, () => {
  console.log(`SIT-Cockpit läuft auf http://localhost:${config.port}${config.demo ? '  (DEMO – Login-Token: demo-rene)' : ''}`);
  console.log(`  weclapp: ${config.weclappBaseUrl}`);
  console.log(`  Atera:   ${config.ateraBaseUrl}`);
  atera.startBackgroundRefresh();
});
