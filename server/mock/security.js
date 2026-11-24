// Demo-Quellen für die Security-Seite (gleiche Formate wie die echten Feeds)
import express from 'express';

const D = 864e5;
const now = Date.now();
const day = (d) => new Date(now - d * D);
const isoDate = (d) => day(d).toISOString().slice(0, 10);
const rfc822 = (d) => day(d).toUTCString().replace('GMT', '+0000');

const kev = {
  catalogVersion: isoDate(0).replace(/-/g, '.'), count: 5,
  vulnerabilities: [
    { cveID: 'CVE-2026-90001', vendorProject: 'Fortinet', product: 'FortiOS', vulnerabilityName: 'Fortinet FortiOS Missing Authentication for Critical Function', dateAdded: isoDate(4), shortDescription: 'FortiOS HA allows unauthenticated command execution.', requiredAction: 'Apply mitigations per vendor instructions or discontinue use of the product.', dueDate: isoDate(-17), knownRansomwareCampaignUse: 'Known' },
    { cveID: 'CVE-2026-96951', vendorProject: 'Microsoft', product: 'Windows', vulnerabilityName: 'Microsoft Windows Shell Security Feature Bypass', dateAdded: isoDate(13), shortDescription: 'Windows Shell bypass.', requiredAction: 'Apply mitigations per vendor instructions.', dueDate: isoDate(-8), knownRansomwareCampaignUse: 'Unknown' },
    { cveID: 'CVE-2026-77777', vendorProject: 'Veeam', product: 'Backup & Replication', vulnerabilityName: 'Veeam Backup & Replication Deserialization', dateAdded: isoDate(20), shortDescription: 'Remote code execution in Veeam Backup & Replication.', requiredAction: 'Apply updates per vendor instructions.', dueDate: isoDate(-1), knownRansomwareCampaignUse: 'Known' },
    { cveID: 'CVE-2025-12345', vendorProject: 'Synology', product: 'DiskStation Manager (DSM)', vulnerabilityName: 'Synology DSM Improper Authentication', dateAdded: isoDate(200), shortDescription: 'Synology DSM authentication bypass.', requiredAction: 'Apply updates per vendor instructions.', dueDate: isoDate(179), knownRansomwareCampaignUse: 'Unknown' },
    { cveID: 'CVE-2020-29583', vendorProject: 'Zyxel', product: 'Multiple Products', vulnerabilityName: 'Zyxel Hard-Coded Credentials', dateAdded: isoDate(3), shortDescription: 'Zyxel', requiredAction: 'Apply updates.', dueDate: isoDate(-20), knownRansomwareCampaignUse: 'Unknown' },
  ],
};

const forti = [
  { id: 'FG-IR-26-273', title: 'Unauthenticated adjacent command execution via HA', d: 5, cvss: 9.0, cve: 'CVE-2026-90001', product: 'FortiOS', affected: ['FortiOS >=7.6.0|<=7.6.7', 'FortiOS >=7.4.0|<=7.4.12'], fix: 'FortiOS 7.6: Upgrade to 7.6.8 or above\nFortiOS 7.4: Upgrade to 7.4.13 or above' },
  { id: 'FG-IR-26-266', title: 'SSLVPN Improper Certificate Validation', d: 9, cvss: 5.3, cve: 'CVE-2026-90003', product: 'FortiOS', affected: ['FortiOS >=7.2.0|<=7.2.11'], fix: 'FortiOS 7.2: Upgrade to 7.2.12 or above' },
  { id: 'FG-IR-26-251', title: 'SQL injection in FortiClient EMS', d: 16, cvss: 7.8, cve: 'CVE-2026-90002', product: 'FortiClientEMS', affected: ['FortiClientEMS >=7.4.0|<=7.4.3'], fix: 'FortiClientEMS 7.4: Upgrade to 7.4.4 or above' },
  { id: 'FG-IR-26-240', title: 'Path traversal in FortiSIEM', d: 22, cvss: 6.5, cve: 'CVE-2026-90004', product: 'FortiSIEM', affected: ['FortiSIEM 7.1 all versions'], fix: 'Migrate to a fixed release' },
];
const rss = (base) => `<?xml version='1.0' encoding='UTF-8'?><rss xmlns:csaf="https://fortiguard.fortinet.com/rss/ns/csaf" version="2.0"><channel><title>FortiGuard</title>${forti.map((f) => `<item><title>${f.title}</title><link>https://fortiguard.fortinet.com/psirt/${f.id}</link><description><![CDATA[<p><strong>CVSSv3 Score:</strong> ${f.cvss}</p><p>A vulnerability in ${f.product} may allow an attacker to ${f.title.toLowerCase()}.</p>]]></description><pubDate>${rfc822(f.d)}</pubDate><csaf:link>${base}/csaf/${f.id}.json</csaf:link></item>`).join('')}</channel></rss>`;
const csaf = (f) => ({
  document: { title: f.title, tracking: { id: f.id, initial_release_date: day(f.d).toISOString(), current_release_date: day(f.d - 1 > 0 ? f.d - 1 : f.d).toISOString() } },
  product_tree: { branches: [{ name: 'Fortinet', branches: [{ name: f.product, branches: f.affected.map((a) => ({ product: { name: a.replace(/\|/, ' ') } })) }] }] },
  vulnerabilities: [{ cve: f.cve, scores: [{ cvss_v3: { baseScore: f.cvss } }], product_status: { known_affected: f.affected }, remediations: [{ category: 'vendor_fix', details: f.fix }] }],
});

const msrc = [
  { cveNumber: 'CVE-2026-96951', cveTitle: 'Windows Shell Security Feature Bypass Vulnerability', tag: 'Windows Shell', severity: 'Important', impact: 'Security Feature Bypass', exploited: 'Yes', publiclyDisclosed: 'No', baseScore: '8.8', customerActionRequired: true, releaseDate: day(13).toISOString(), latestRevisionDate: day(13).toISOString(), releaseNumber: '2026-Nov' },
  { cveNumber: 'CVE-2026-96010', cveTitle: 'Windows DHCP Server Remote Code Execution Vulnerability', tag: 'Windows DHCP Server', severity: 'Critical', impact: 'Remote Code Execution', exploited: 'No', publiclyDisclosed: 'No', baseScore: '9.8', customerActionRequired: true, releaseDate: day(13).toISOString(), latestRevisionDate: day(13).toISOString(), releaseNumber: '2026-Nov' },
  { cveNumber: 'CVE-2026-96020', cveTitle: 'Microsoft Exchange Server Remote Code Execution Vulnerability', tag: 'Microsoft Exchange Server', severity: 'Critical', impact: 'Remote Code Execution', exploited: 'No', publiclyDisclosed: 'Yes', baseScore: '9.0', customerActionRequired: true, releaseDate: day(13).toISOString(), latestRevisionDate: day(13).toISOString(), releaseNumber: '2026-Nov' },
  { cveNumber: 'CVE-2026-96030', cveTitle: 'Microsoft Excel Remote Code Execution Vulnerability', tag: 'Microsoft Office Excel', severity: 'Critical', impact: 'Remote Code Execution', exploited: 'No', publiclyDisclosed: 'No', baseScore: '7.8', customerActionRequired: true, releaseDate: day(44).toISOString(), latestRevisionDate: day(44).toISOString(), releaseNumber: '2026-Oct' },
  { cveNumber: 'CVE-2026-96040', cveTitle: 'Azure App Service Elevation of Privilege Vulnerability', tag: 'Azure App Service', severity: 'Critical', impact: 'Elevation of Privilege', exploited: 'No', publiclyDisclosed: 'No', baseScore: '10.0', customerActionRequired: false, releaseDate: day(13).toISOString(), latestRevisionDate: day(13).toISOString(), releaseNumber: '2026-Nov' },
];

const synology = `<table><tbody>${[
  ['Synology_SA_26_09', 'Synology-SA-26:09 DSM', 'Critical', 'Ongoing', 6],
  ['Synology_SA_26_08', 'Synology-SA-26:08 Linux Kernel (Copy Fail)', 'Not affected', 'Resolved', 30],
  ['Synology_SA_26_07', 'Synology-SA-26:07 DSM', 'Moderate', 'Resolved', 70],
].map(([href, title, sev, st, d]) => `<tr><td data-label="Advisory"><div class="content"><a rel="noopener noreferrer" href="security/advisory/${href}">${title}</a></div></td>
<td data-label="Severity"><div class="content"><a href="security/advisory/${href}"><i class="icon_impact"></i> <span class="item_txt impact_txt">${sev}</span></a></div></td>
<td data-label="Status"><div class="content"><a href="security/advisory/${href}"><i class="icon_status"></i> <span class="item_txt status_txt">${st}</span></a></div></td>
<td data-label="Last Updated"><div class="content advisory_last_updated"><a href="security/advisory/${href}"><time>${day(d).toISOString().slice(0, 19).replace('T', ' ')}</time> UTC+8</a></div></td></tr>`).join('\n')}</tbody></table>`;

const nvd = {
  Veeam: [{ id: 'CVE-2026-77777', d: 21, score: 9.9, text: 'A deserialization vulnerability in Veeam Backup & Replication allows remote code execution by an authenticated domain user.' }],
  '3CX': [{ id: 'CVE-2026-66666', d: 35, score: 7.5, text: 'Improper access control in 3CX Phone System management console allows information disclosure.' }],
  'VMware ESXi': [{ id: 'CVE-2026-55501', d: 50, score: 8.2, text: 'VMware ESXi contains an out-of-bounds write vulnerability in the VMX process.' }],
};

export function securityMock() {
  const r = express.Router();
  const base = (req) => `${req.protocol}://${req.get('host')}${req.baseUrl}`;
  r.get('/kev.json', (req, res) => res.json(kev));
  r.get('/fortinet.xml', (req, res) => res.type('application/xml').send(rss(base(req))));
  r.get('/csaf/:id.json', (req, res) => {
    const f = forti.find((x) => x.id === req.params.id);
    f ? res.json(csaf(f)) : res.status(404).end();
  });
  r.get('/msrc', (req, res) => res.json({ '@odata.count': msrc.length, value: msrc }));
  r.get('/synology.html', (req, res) => res.type('text/html').send(synology));
  r.get('/nvd', (req, res) => {
    const rows = nvd[req.query.keywordSearch] || [];
    res.json({ totalResults: rows.length, vulnerabilities: rows.map((v) => ({ cve: {
      id: v.id, published: day(v.d).toISOString(), lastModified: day(v.d).toISOString(), vulnStatus: 'Analyzed',
      descriptions: [{ lang: 'en', value: v.text }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: v.score } }] },
    } })) });
  });
  r.get('/epss', (req, res) => {
    const cves = String(req.query.cve || '').split(',').filter(Boolean);
    res.json({ data: cves.map((c) => ({ cve: c, epss: String(((Number(c.slice(-3)) % 97) / 100).toFixed(4)) })) });
  });
  return r;
}
