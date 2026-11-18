// PDF für das Angebotsboard: Leistungsübersicht + Unterschrift des Kunden.
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config } from './config.js';
import { boardSettings } from './offers.js';

const LOGO = fileURLToPath(new URL('../public/img/logo-light-bg.png', import.meta.url));
const ANTHRAZIT = '#231F20';
const GRUEN = '#99CC33';
const GRAU = '#5F5A5B';
const LINIE = '#E4E3E1';

const eur = (v) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(v || 0);
const qty = (v) => new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(v);
const dt = (ms) => new Date(ms).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' });

export function renderOfferPdf(rec) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: `Auftrag ${rec.weclapp?.quotationNumber || rec.id}`, Author: config.companyName } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 50, R = doc.page.width - 50, W = R - L;

    // Kopf
    if (fs.existsSync(LOGO)) doc.image(LOGO, L, 40, { width: 150 });
    doc.font('Helvetica').fontSize(9).fillColor(GRAU)
      .text(config.companyName, L, 45, { width: W, align: 'right' });
    if (config.companyAddress) doc.text(config.companyAddress, { width: W, align: 'right' });
    doc.moveTo(L, 100).lineTo(R, 100).lineWidth(2).strokeColor(GRUEN).stroke();

    // Titel
    doc.fillColor(ANTHRAZIT).font('Helvetica-Bold').fontSize(18)
      .text(rec.preview ? 'Angebot (Entwurf)' : 'Auftrag Managed Services', L, 118);
    doc.font('Helvetica').fontSize(9).fillColor(GRAU);
    const meta = [];
    if (rec.weclapp?.quotationNumber) meta.push(`Angebot ${rec.weclapp.quotationNumber}`);
    if (rec.weclapp?.salesOrderNumber) meta.push(`Auftrag ${rec.weclapp.salesOrderNumber}`);
    if (!rec.preview) meta.push(`Vorgang ${rec.id}`);
    meta.push(`Datum ${new Date(rec.signedAt || Date.now()).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`);
    doc.text(meta.join('   ·   '), L, 142);

    // Kunde
    let y = 172;
    if (rec.customer) {
      doc.fillColor(GRAU).fontSize(8).text('KUNDE', L, y);
      doc.fillColor(ANTHRAZIT).font('Helvetica-Bold').fontSize(11).text(rec.customer.name, L, y + 12);
      doc.font('Helvetica').fontSize(9).fillColor(ANTHRAZIT);
      const lines = [rec.customer.number && `Kundennummer ${rec.customer.number}`, rec.customer.address, rec.customer.email].filter(Boolean);
      doc.text(lines.join('\n'), L, y + 27);
      y = doc.y + 18;
    }

    // Positionen
    const cols = [
      { k: 'name', t: 'Leistung', x: L, w: 235 },
      { k: 'quantity', t: 'Menge', x: L + 240, w: 50, a: 'right' },
      { k: 'unit', t: 'Einheit', x: L + 296, w: 60 },
      { k: 'unitPrice', t: 'Einzelpreis', x: L + 358, w: 65, a: 'right' },
      { k: 'net', t: 'Gesamt netto', x: L + 425, w: W - 425, a: 'right' },
    ];
    const header = () => {
      doc.rect(L, y, W, 18).fill('#F3F2EF');
      doc.fillColor(GRAU).font('Helvetica-Bold').fontSize(8);
      for (const c of cols) doc.text(c.t, c.x + 3, y + 5, { width: c.w - 6, align: c.a || 'left' });
      y += 22;
    };
    const ensure = (h) => { if (y + h > doc.page.height - 70) { doc.addPage(); y = 50; } };

    const section = (title, rows, sub) => {
      if (!rows.length) return;
      ensure(60);
      doc.fillColor(ANTHRAZIT).font('Helvetica-Bold').fontSize(11).text(title, L, y);
      if (sub) doc.font('Helvetica').fontSize(8.5).fillColor(GRAU).text(sub, L, y + 1, { width: W, align: 'right' });
      y += 18;
      header();
      for (const l of rows) {
        doc.font('Helvetica-Bold').fontSize(9.5);
        const hName = doc.heightOfString(l.name, { width: cols[0].w - 6 });
        doc.font('Helvetica').fontSize(8);
        const hDesc = l.description ? doc.heightOfString(l.description.slice(0, 300), { width: cols[0].w - 6 }) : 0;
        const h = Math.max(hName + hDesc + 6, 18);
        ensure(h + 6);
        doc.fillColor(ANTHRAZIT).font('Helvetica-Bold').fontSize(9.5).text(l.name, cols[0].x + 3, y, { width: cols[0].w - 6 });
        if (l.description) doc.font('Helvetica').fontSize(8).fillColor(GRAU).text(l.description.slice(0, 300), cols[0].x + 3, y + hName + 1, { width: cols[0].w - 6 });
        doc.font('Helvetica').fontSize(9.5).fillColor(ANTHRAZIT);
        doc.text(qty(l.quantity), cols[1].x + 3, y, { width: cols[1].w - 6, align: 'right' });
        doc.text(l.unit, cols[2].x + 3, y, { width: cols[2].w - 6 });
        doc.text(eur(l.unitPrice), cols[3].x + 3, y, { width: cols[3].w - 6, align: 'right' });
        doc.text(eur(l.net), cols[4].x + 3, y, { width: cols[4].w - 6, align: 'right' });
        if (l.discount) doc.fontSize(7.5).fillColor(GRAU).text(`inkl. ${qty(l.discount)} % Rabatt`, cols[4].x + 3, y + 12, { width: cols[4].w - 6, align: 'right' });
        y += h + 4;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINIE).stroke();
        y += 6;
      }
    };
    const monthly = rec.lines.filter((l) => l.billing === 'monthly');
    const once = rec.lines.filter((l) => l.billing === 'once');
    section('Monatliche Leistungen', monthly, `Laufzeit ${rec.termMonths} Monate`);
    if (monthly.length && once.length) y += 8;
    section('Einmalige Leistungen', once);

    // Summen
    ensure(110);
    y += 6;
    const t = rec.totals;
    const sumRow = (label, value, bold = false, big = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 12 : 9.5).fillColor(ANTHRAZIT);
      doc.text(label, L + 240, y, { width: 180 });
      doc.text(value, L + 420, y, { width: W - 420, align: 'right' });
      y += big ? 18 : 14;
    };
    if (monthly.length) {
      sumRow('Monatlich netto', eur(t.monthlyNet), true, true);
      sumRow(`zzgl. ${t.vatPercent} % USt.`, eur(t.monthlyGross - t.monthlyNet));
      sumRow('Monatlich brutto', eur(t.monthlyGross), true);
      y += 6;
    }
    if (once.length) {
      sumRow('Einmalig netto', eur(t.onceNet), true);
      sumRow('Einmalig brutto', eur(t.onceGross));
      y += 6;
    }
    if (monthly.length) {
      doc.font('Helvetica').fontSize(8.5).fillColor(GRAU)
        .text(`Gesamtwert über die Laufzeit (netto): ${eur(t.contractNet)}`, L + 240, y, { width: W - 240, align: 'right' });
      y += 16;
    }

    // Bedingungen
    ensure(70);
    y += 8;
    doc.font('Helvetica').fontSize(8.5).fillColor(ANTHRAZIT);
    const fill = (t) => String(t).replace(/\{laufzeit\}/g, rec.termMonths).replace(/\{agb\}/g, config.termsUrl).replace(/\{firma\}/g, config.companyName);
    const settings = boardSettings();
    const terms = [
      ...(settings.pdfTerms || ['Alle Preise in Euro.', 'Es gelten die Allgemeinen Geschäftsbedingungen von {firma} ({agb}).']),
      ...(monthly.length ? [settings.pdfTermsMonthly || 'Monatliche Leistungen werden monatlich im Voraus verrechnet, die Laufzeit beträgt {laufzeit} Monate ab Leistungsbeginn.'] : []),
      ...(once.length ? [settings.pdfTermsOnce || 'Einmalige Leistungen werden nach Erbringung verrechnet.'] : []),
    ].map(fill);
    if (rec.note) terms.push(`Vereinbarung: ${rec.note}`);
    doc.text(terms.join('\n'), L, y, { width: W, lineGap: 2 });
    y = doc.y + 18;

    // Unterschrift
    if (!rec.preview) {
      ensure(150);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ANTHRAZIT)
        .text('Beauftragung', L, y);
      y += 15;
      doc.font('Helvetica').fontSize(8.5).fillColor(ANTHRAZIT)
        .text('Mit der Unterschrift beauftragt der Kunde die oben angeführten Leistungen zu den angegebenen Konditionen und bestätigt die Kenntnisnahme der AGB.', L, y, { width: W });
      y = doc.y + 8;
      try {
        const img = Buffer.from(rec.signature.split(',')[1], 'base64');
        doc.image(img, L, y, { fit: [240, 80] });
      } catch { /* ohne Bild weiter */ }
      doc.moveTo(L, y + 84).lineTo(L + 240, y + 84).lineWidth(0.8).strokeColor(ANTHRAZIT).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(ANTHRAZIT)
        .text(`${rec.signer.name}${rec.signer.role ? `, ${rec.signer.role}` : ''}`, L, y + 88)
        .fillColor(GRAU).text(`für ${rec.customer.name} · unterschrieben am ${dt(rec.signedAt)}`, L, y + 100);
      doc.fillColor(ANTHRAZIT).text(`Aufgenommen von ${rec.seller.name}`, L + 290, y + 88, { width: W - 290 })
        .fillColor(GRAU).text(config.companyName, L + 290, y + 100, { width: W - 290 });
      y += 125;
    }

    // Fußzeile auf jeder Seite
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // sonst erzeugt Text im Randbereich eine neue Seite
      doc.font('Helvetica').fontSize(7).fillColor(GRAU);
      const foot = rec.preview
        ? 'Entwurf – nicht unterschrieben'
        : `Elektronisch unterschrieben über das SIT-Cockpit · Prüfsumme ${String(rec.hash || '').slice(0, 32)}`;
      doc.text(`${foot}   ·   Seite ${i + 1} von ${range.count}`, L, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
