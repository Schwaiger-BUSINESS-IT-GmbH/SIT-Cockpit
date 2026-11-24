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
  // ---------- SIT-Time (eigene App, wird unter #/zeiten eingebettet) ----------
  timeUrl: (process.env.TIME_URL || (demo ? 'http://localhost:3100' : 'https://time.schwaiger-it.at')).replace(/\/+$/, ''),
  // ---------- Atera ----------
  ateraBaseUrl: demo ? `${self}/__mock/atera/api/v3` : process.env.ATERA_BASE_URL || 'https://app.atera.com/api/v3',
  ateraApiKey: demo ? 'demo-atera-key' : process.env.ATERA_API_KEY || '',
  ateraWebUrl: process.env.ATERA_WEB_URL || 'https://app.atera.com',
  ateraRefreshSeconds: num(process.env.ATERA_REFRESH_SECONDS, 180),
  // Name des Atera-Kundenfelds mit der weclapp-Kundennummer
  ateraCustomerNumberField: process.env.ATERA_CUSTOMER_NUMBER_FIELD || 'weclapp-Kundennummer',
  // Regeln (siehe docs/anforderungen.md)
  serverOfflineMinutes: num(process.env.SERVER_OFFLINE_MINUTES, 15),
  // Server länger als X Tage offline = veraltet (vermutlich abgebaut), zählt nicht zur Ampel
  staleServerDays: num(process.env.STALE_SERVER_DAYS, 30),
  // ---------- Angebotsboard ----------
  // Nach der Unterschrift automatisch einen Auftrag erzeugen
  offerCreateSalesOrder: process.env.OFFER_CREATE_SALES_ORDER !== '0',
  offerValidDays: num(process.env.OFFER_VALID_DAYS, 30),
  companyName: process.env.COMPANY_NAME || 'Schwaiger Business IT',
  companyAddress: process.env.COMPANY_ADDRESS || '',
  termsUrl: process.env.TERMS_URL || 'https://www.schwaiger-it.at/agb',
  vatPercent: num(process.env.VAT_PERCENT, 20),
  // Nur-Lese-Token eines weclapp-Benutzers mit Vertragslizenz (Managed-Service-Umsatz), optional
  weclappContractsToken: process.env.WECLAPP_CONTRACTS_TOKEN || '',
  // ---------- Finanzen (nur Entra-Gruppe) ----------
  financeGroupId: process.env.FINANCE_GROUP_ID || '',
  financeLocal: process.env.FINANCE_LOCAL === '1', // nur lokale Entwicklung ohne Microsoft-Login
  // ---------- Security (öffentliche Quellen, keine Schlüssel nötig) ----------
  security: {
    kevUrl: demo ? `${self}/__mock/security/kev.json` : process.env.SEC_KEV_URL || 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    fortinetUrl: demo ? `${self}/__mock/security/fortinet.xml` : process.env.SEC_FORTINET_URL || 'https://filestore.fortinet.com/fortiguard/rss/ir.xml',
    msrcUrl: demo ? `${self}/__mock/security/msrc` : process.env.SEC_MSRC_URL || 'https://api.msrc.microsoft.com/sug/v2.0/en-US/vulnerability',
    synologyUrl: demo ? `${self}/__mock/security/synology.html` : process.env.SEC_SYNOLOGY_URL || 'https://www.synology.com/en-global/security/advisory',
    nvdUrl: demo ? `${self}/__mock/security/nvd` : process.env.SEC_NVD_URL || 'https://services.nvd.nist.gov/rest/json/cves/2.0',
    nvdApiKey: process.env.NVD_API_KEY || '', // optional, höheres Abfragelimit
    epssUrl: demo ? `${self}/__mock/security/epss` : process.env.SEC_EPSS_URL || 'https://api.first.org/data/v1/epss',
    refreshHours: num(process.env.SEC_REFRESH_HOURS, 3),
  },
  // Interner Kostensatz je Technikerstunde (Lohn + Nebenkosten) für die Vertragsrentabilität
  internalHourlyCost: num(process.env.INTERNAL_HOURLY_COST, 60),
  // Artikel/Kategorien mit diesem Muster im Namen gelten als Wartungsleistung (tragen Stunden)
  maintenanceArticlePattern: process.env.MAINTENANCE_ARTICLE_PATTERN || 'wartung',
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
