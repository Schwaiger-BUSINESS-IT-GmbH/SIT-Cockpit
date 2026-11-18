// Atera-Mock (API v3) für den Demo-Modus. Liefert realistische Beispieldaten
// im Originalformat, damit der echte Client-Code durchlaufen wird.
import express from 'express';

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString().replace('Z', '');
const MIN = 60000, H = 3600e3, D = 864e5;

const customers = [
  [1, 'Bäckerei Huber GmbH', 'Linz'],
  [2, 'Steuerberatung Lang & Partner', 'Wels'],
  [3, 'Autohaus Maier KG', 'Steyr'],
  [4, 'Tischlerei Gruber', 'Freistadt'],
  [5, 'Ordination Dr. Wimmer', 'Linz'],
  [6, 'Hotel Seeblick GmbH', 'Gmunden'],
  [7, 'Bauunternehmen Wagner & Söhne', 'Ried im Innkreis'],
  [8, 'Gemeindeamt Neukirchen', 'Neukirchen'],
  [9, 'Kanzlei Dr. Pichler', 'Linz'],
  [10, 'Elektro Hofer e.U.', 'Enns'],
].map(([CustomerID, CustomerName, City]) => ({ CustomerID, CustomerName, City, Country: 'Austria', CreatedOn: iso(400 * D) }));

let id = 1000;
const disk = (totalGb, freeGb, Drive = 'C:') => ({ Drive, Total: totalGb * 1024, Free: freeGb * 1024 });
function agent(CustomerID, MachineName, type, { online = true, seen = 2 * MIN, disks = [disk(256, 120)], user = '', desc = '' } = {}) {
  const c = customers.find((x) => x.CustomerID === CustomerID);
  const server = type === 'server' || type === 'dc';
  id++;
  return {
    AgentID: id,
    DeviceGuid: `dev-${id}`,
    CustomerID,
    CustomerName: c.CustomerName,
    MachineName,
    AgentName: MachineName,
    ComputerDescription: desc,
    Online: online,
    LastSeen: iso(seen),
    LastRebootTime: iso(3 * D + id * MIN),
    OSType: type === 'dc' ? 'Domain Controller' : server ? 'Server' : 'Work Station',
    OS: server ? 'Windows Server 2022 Standard' : type === 'mac' ? 'macOS 15 Sequoia' : 'Windows 11 Pro',
    Processor: server ? 'Intel Xeon E-2336' : 'Intel Core i5-1335U',
    Memory: server ? 65536 : 16384,
    CurrentLoggedUsers: user,
    ReportedFromIP: `10.0.${CustomerID}.${id % 200}`,
    HardwareDisks: disks,
    Monitored: true,
  };
}

const agents = [
  // 1 Bäckerei Huber – Backup-Problem am Server
  agent(1, 'HUBER-SRV01', 'dc', { disks: [disk(480, 210), disk(2000, 900, 'D:')], desc: 'Fileserver / AD' }),
  agent(1, 'HUBER-KASSA1', 'ws', { user: 'kassa' }),
  agent(1, 'HUBER-BUERO', 'ws', { user: 'm.huber' }),
  agent(1, 'HUBER-LAPTOP-CHEF', 'ws', { online: false, seen: 2 * D }),
  // 2 Steuerberatung Lang – alles gut
  agent(2, 'LANG-SRV-DC01', 'dc', { disks: [disk(480, 300)] }),
  agent(2, 'LANG-SRV-APP01', 'server', { disks: [disk(480, 260), disk(4000, 2100, 'E:')], desc: 'BMD NTCS' }),
  ...['LANG-PC01', 'LANG-PC02', 'LANG-PC03', 'LANG-PC04', 'LANG-PC05', 'LANG-NB-SEKR'].map((n, i) => agent(2, n, 'ws', { user: `user${i + 1}` })),
  // 3 Autohaus Maier – Server offline (kritisch)
  agent(3, 'MAIER-SRV01', 'server', { online: false, seen: 47 * MIN, desc: 'Werkstattsystem' }),
  agent(3, 'MAIER-WERKSTATT1', 'ws'),
  agent(3, 'MAIER-VERKAUF1', 'ws'),
  agent(3, 'MAIER-VERKAUF2', 'ws', { online: false, seen: 12 * D }),
  // 4 Tischlerei Gruber – Speicher knapp
  agent(4, 'GRUBER-SRV', 'server', { disks: [disk(240, 9), disk(1000, 400, 'D:')] }),
  agent(4, 'GRUBER-CAD01', 'ws', { disks: [disk(1000, 520)] }),
  // 5 Ordination Dr. Wimmer – möglicher Ausfall
  agent(5, 'ORD-WIMMER-SRV', 'server', { online: false, seen: 22 * MIN }),
  agent(5, 'ORD-EMPFANG1', 'ws', { online: false, seen: 24 * MIN }),
  agent(5, 'ORD-EMPFANG2', 'ws', { online: false, seen: 23 * MIN }),
  agent(5, 'ORD-BEHANDLUNG1', 'ws', { online: false, seen: 25 * MIN }),
  agent(5, 'ORD-LABOR', 'ws', { online: true }),
  // 6 Hotel Seeblick – Warnungen
  agent(6, 'SEEBLICK-SRV01', 'server'),
  agent(6, 'SEEBLICK-REZEPTION', 'ws'),
  agent(6, 'SEEBLICK-BUCHHALTUNG', 'ws'),
  agent(6, 'SEEBLICK-KUECHE-POS', 'ws', { online: false, seen: 9 * D }),
  // 7 Wagner Bau – ok
  agent(7, 'WAGNER-SRV01', 'dc'),
  agent(7, 'WAGNER-BAULEITUNG-NB1', 'ws'),
  agent(7, 'WAGNER-BAULEITUNG-NB2', 'ws'),
  agent(7, 'WAGNER-MAC-PLANUNG', 'mac'),
  // 8 Gemeindeamt – ok
  agent(8, 'GEM-NEUKIRCHEN-SRV', 'dc'),
  agent(8, 'GEM-AMTSLEITUNG', 'ws'),
  agent(8, 'GEM-BUERGERSERVICE', 'ws'),
  // 9 Kanzlei Pichler – CPU-Alert
  agent(9, 'PICHLER-SRV', 'server'),
  agent(9, 'PICHLER-PC01', 'ws'),
  // 10 Elektro Hofer – nur Laptops
  agent(10, 'HOFER-NB01', 'ws'),
  agent(10, 'HOFER-NB02', 'ws', { online: false, seen: 3 * H }),
];

const dev = (name) => agents.find((a) => a.MachineName === name);
let alertId = 5000;
const alert = (name, Severity, Title, ago, AlertCategoryID = 'General') => {
  const a = dev(name);
  return { AlertID: ++alertId, Severity, Title, Created: iso(ago), DeviceGuid: a.DeviceGuid, DeviceName: a.MachineName, CustomerID: a.CustomerID, CustomerName: a.CustomerName, AlertCategoryID, Archived: false, Source: 'Atera' };
};
const alerts = [
  alert('HUBER-SRV01', 'Critical', 'Backup-Job "Nacht" fehlgeschlagen (Veeam)', 7 * H, 'Backup'),
  alert('MAIER-SRV01', 'Critical', 'Agent nicht erreichbar', 45 * MIN, 'Availability'),
  alert('SEEBLICK-SRV01', 'Warning', 'Windows-Updates seit 35 Tagen ausstehend', 2 * D, 'General'),
  alert('SEEBLICK-REZEPTION', 'Warning', 'Festplatte meldet SMART-Fehler', 5 * H, 'Hardware'),
  alert('PICHLER-SRV', 'Warning', 'CPU-Auslastung über 90 % seit 30 Min.', 40 * MIN, 'Performance'),
  alert('LANG-PC03', 'Information', 'Neue Software installiert', 3 * H, 'General'),
  { ...alert('WAGNER-SRV01', 'Critical', 'Dienst gestoppt (bereits erledigt)', 5 * D), Archived: true },
];

const page = (rows, q) => {
  const per = Math.min(Number(q.itemsInPage) || 20, 50);
  const p = Math.max(Number(q.page) || 1, 1);
  return { items: rows.slice((p - 1) * per, p * per), totalItemCount: rows.length, page: p, itemsInPage: per, totalPages: Math.ceil(rows.length / per) };
};

export function ateraMock() {
  const r = express.Router();
  r.use((req, res, next) => (req.get('X-API-KEY') === 'demo-atera-key' || req.get('Authorization') === 'Bearer demo-atera-key' ? next() : res.status(401).json({ Message: 'Unauthorized' })));
  r.get('/customers', (req, res) => res.json(page(customers, req.query)));
  r.get('/agents', (req, res) => res.json(page(agents, req.query)));
  r.get('/alerts', (req, res) => res.json(page(alerts, req.query)));
  r.get('/customvalues/customerfield/:id/:field', (req, res) => {
    const nr = { 1: 'K-10001', 2: 'K-10002', 3: 'K-10003', 4: 'K-10004', 5: 'K-10005', 6: 'K-10006' }[req.params.id];
    res.json(nr ? [{ ValueAsString: nr }] : []);
  });
  return r;
}
