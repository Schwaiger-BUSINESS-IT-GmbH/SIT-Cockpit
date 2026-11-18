// Lädt .env (Node >= 20.12) und stellt die Konfiguration bereit.
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(); } catch { /* keine .env vorhanden – ok */ }

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const demo = process.env.DEMO === '1';
const port = Number(process.env.PORT || 3000);
const self = `http://127.0.0.1:${port}`;

const tenant = (process.env.WECLAPP_TENANT || '')
  .replace(/^https?:\/\//, '').replace(/\.weclapp\.com.*$/, '').replace(/\/+$/, '');

export const config = {
  demo,
  port,
  // ---------- weclapp ----------
  weclappBaseUrl: demo
    ? `${self}/__mock/weclapp/webapp/api/v2`
    : process.env.WECLAPP_BASE_URL || (tenant ? `https://${tenant}.weclapp.com/webapp/api/v2` : ''),
  // Web-Oberfläche von weclapp (für "In weclapp öffnen"-Links)
  weclappWebUrl: process.env.WECLAPP_WEB_URL || (tenant ? `https://${tenant}.weclapp.com/webapp` : ''),
  // ---------- Atera ----------
  ateraBaseUrl: demo ? `${self}/__mock/atera/api/v3` : process.env.ATERA_BASE_URL || 'https://app.atera.com/api/v3',
  ateraApiKey: demo ? 'demo-atera-key' : process.env.ATERA_API_KEY || '',
  ateraWebUrl: process.env.ATERA_WEB_URL || 'https://app.atera.com',
  ateraRefreshSeconds: num(process.env.ATERA_REFRESH_SECONDS, 180),
  // Name des Atera-Kundenfelds mit der weclapp-Kundennummer
  ateraCustomerNumberField: process.env.ATERA_CUSTOMER_NUMBER_FIELD || 'weclapp-Kundennummer',
  // Regeln (siehe docs/anforderungen.md)
  serverOfflineMinutes: num(process.env.SERVER_OFFLINE_MINUTES, 15),
  workstationOfflineDays: num(process.env.WORKSTATION_OFFLINE_DAYS, 7),
  // ---------- Angebotsboard ----------
  // Artikelkategorie in weclapp mit den Managed-Service-Artikeln
  offerArticleCategory: process.env.OFFER_ARTICLE_CATEGORY || 'Managed Services',
  // Alternativ/zusätzlich: feste Artikelnummern (kommagetrennt)
  offerArticleNumbers: list(process.env.OFFER_ARTICLE_NUMBERS),
  // Nach der Unterschrift automatisch einen Auftrag erzeugen
  offerCreateSalesOrder: process.env.OFFER_CREATE_SALES_ORDER !== '0',
  offerValidDays: num(process.env.OFFER_VALID_DAYS, 30),
  companyName: process.env.COMPANY_NAME || 'Schwaiger Business IT',
  companyAddress: process.env.COMPANY_ADDRESS || '',
  termsUrl: process.env.TERMS_URL || 'https://www.schwaiger-it.at/agb',
  vatPercent: num(process.env.VAT_PERCENT, 20),
  // ---------- Dashboard ----------
  quotationFollowUpDays: num(process.env.QUOTATION_FOLLOWUP_DAYS, 14),
  // ---------- SIT-Time (Zeiten) ----------
  roundMinutes: num(process.env.ROUND_MINUTES, 15),
  articleType: process.env.ARTICLE_TYPE ?? 'SERVICE',
  articleNumbers: list(process.env.ARTICLE_NUMBERS),
  hiddenTicketStatusIds: list(process.env.TICKET_HIDDEN_STATUS_IDS),
  hiddenStatusPattern: process.env.TICKET_HIDDEN_STATUS_PATTERN ?? '^(geschlossen|abgeschlossen|erledigt|closed|storniert)$',
  weclappAttendance: process.env.WECLAPP_ATTENDANCE !== '0',
  // ---------- Allgemein ----------
  sessionSecret: process.env.SESSION_SECRET || (demo ? 'demo-secret-demo-secret-demo-secret-123' : ''),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  requireEntra: process.env.REQUIRE_ENTRA === '1',
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL(demo ? '../data-demo/' : '../data/', import.meta.url)),
};

if (!config.weclappBaseUrl) {
  console.error('FEHLER: WECLAPP_TENANT oder WECLAPP_BASE_URL muss gesetzt sein (siehe .env.example) – oder DEMO=1.');
  process.exit(1);
}
if (config.sessionSecret.length < 32) {
  console.error('FEHLER: SESSION_SECRET muss mindestens 32 Zeichen lang sein.');
  process.exit(1);
}
if (!config.ateraApiKey) {
  console.warn('Hinweis: ATERA_API_KEY fehlt – die Kundenübersicht bleibt leer.');
}
