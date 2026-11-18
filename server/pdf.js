// PDF für das Angebotsboard im Stil der Angebotsvorschau (SIT_Angebotsboard_V4):
// Logo, grüne Linie, Positionen mit Artikelnummer und optionaler
// Leistungsbeschreibung, Summenblock, Abgrenzung, Unterschrift.
// Die interne Kundenkategorie erscheint NIE im PDF.
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config } from './config.js';
import { boardSettings } from './offers.js';

const LOGO = fileURLToPath(new URL('../public/img/logo-light-bg.png', import.meta.url));
const INK = '#231F20';
const LIME = '#99CC33';
const MUTED = '#625C5D';
const LINE = '#E6E4DF';

const eur = (v) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(v || 0);
const dt = (ms) => new Date(ms).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' });

export function renderOfferPdf(rec) {
  return new Promise((resolve, reject) => {
    const s = boardSettings();
    const company = s.company || { name: config.companyName };
    const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true, info: { Title: `Angebot ${rec.weclapp?.quotationNumber || rec.id}`, Author: company.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 46, R = doc.page.width - 46, W = R - L;
    const bottom = () => doc.page.height - 64;
    let y = 40;
    const ensure = (h) => { if (y + h > bottom()) { doc.addPage(); y = 46; } };

    // Kopf
    if (fs.existsSync(LOGO)) doc.image(LOGO, L, y, { width: 150 });
    const pill = rec.preview ? 'ANGEBOTSENTWURF' : 'AUFTRAG';
    doc.font('Helvetica-Bold').fontSize(7.5);
    const pw = doc.widthOfString(pill) + 18;
    doc.roundedRect(R - pw, y + 4, pw, 17, 8.5).fill('#2B2728');
    doc.fillColor('#FFFFFF').text(pill, R - pw, y + 9, { width: pw, align: 'center' });
    y += 54;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text([company.address, company.email].filter(Boolean).join(' · '), L, y, { width: W });
    y += 18;
    doc.roundedRect(L, y, 40, 3, 1.5).fill(LIME);
    y += 16;

    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text('IT-Betreuung und Managed Services', L, y);
    y = doc.y + 4;
    const meta = [];
    if (rec.weclapp?.quotationNumber) meta.push(`Angebot ${rec.weclapp.quotationNumber}`);
    if (rec.weclapp?.salesOrderNumber) meta.push(`Auftrag ${rec.weclapp.salesOrderNumber}`);
    if (!rec.preview) meta.push(`Vorgang ${rec.id}`);
    meta.push(`Datum ${new Date(rec.signedAt || Date.now()).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(meta.join('   ·   '), L, y);
    y = doc.y + 10;

    // Kunde
    const c = rec.customer || {};
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Für: ', L, y, { continued: true })
      .font('Helvetica').text(c.company || 'Neukunde');
    const cl = [c.contact, c.place].filter(Boolean).join(' · ');
    if (cl) doc.text(cl, L);
    if (c.number) doc.fillColor(MUTED).fontSize(8.5).text(`Kundennummer ${c.number}`, L);
    const a = rec.assets || {};
    doc.fillColor(MUTED).fontSize(8.5).text(`${a.users ?? 0} Benutzer · ${a.clients ?? 0} Clients · ${a.servers ?? 0} Server · ${a.firewalls ?? 0} FortiGate · ${a.sites ?? 0} Standorte`, L);
    y = doc.y + 14;

    // Tabellen
    const cols = { name: [L, W - 210], qty: [R - 205, 45], price: [R - 155, 70], sum: [R - 80, 80] };
    const head = () => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
      doc.text('Leistung', cols.name[0], y, { width: cols.name[1] });
      doc.text('Menge', cols.qty[0], y, { width: cols.qty[1], align: 'right' });
      doc.text('Einzelpreis', cols.price[0], y, { width: cols.price[1], align: 'right' });
      doc.text('Summe', cols.sum[0], y, { width: cols.sum[1], align: 'right' });
      y += 13;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(LINE).stroke();
      y += 7;
    };
    const table = (title, items) => {
      ensure(60);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(title, L, y);
      y = doc.y + 6;
      if (!items.length) {
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Keine Positionen gewählt.', L, y);
        y = doc.y + 8;
        return;
      }
      head();
      for (const it of items) {
        const detail = rec.includeDetails !== false ? String(it.desc || '') : '';
        doc.font('Helvetica-Bold').fontSize(9);
        const hName = doc.heightOfString(it.name, { width: cols.name[1] });
        doc.font('Helvetica').fontSize(7.5);
        const hSku = 10;
        const hDet = detail ? doc.heightOfString(detail, { width: cols.name[1] - 10, lineGap: 1 }) + 4 : 0;
        ensure(Math.min(hName + hSku + hDet, 200) + 12);
        const top = y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(it.name, cols.name[0], y, { width: cols.name[1] });
        y = doc.y;
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(it.sku + (it.tierActive ? ' · Staffelpreis' : ''), cols.name[0], y);
        y = doc.y + 2;
        doc.font('Helvetica').fontSize(9).fillColor(INK);
        doc.text(String(it.qty), cols.qty[0], top, { width: cols.qty[1], align: 'right' });
        doc.text(eur(it.price), cols.price[0], top, { width: cols.price[1], align: 'right' });
        doc.font('Helvetica-Bold').text(eur(it.price * it.qty), cols.sum[0], top, { width: cols.sum[1], align: 'right' });
        if (detail) {
          // Beschreibung zeilenweise, damit lange Texte sauber umbrechen und Seiten wechseln
          doc.font('Helvetica').fontSize(7.5).fillColor('#514D4B');
          for (const line of detail.split('\n')) {
            const h = line ? doc.heightOfString(line, { width: cols.name[1] - 10, lineGap: 1 }) : 5;
            ensure(h);
            if (line) doc.text(line, cols.name[0] + 6, y, { width: cols.name[1] - 10, lineGap: 1 });
            y += h;
          }
        }
        y += 6;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(LINE).stroke();
        y += 8;
      }
    };
    const t = rec.totals;
    const sumLine = (label, value, bold = false, last = false) => {
      ensure(18);
      const x = R - 240;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK);
      doc.text(label, x, y, { width: 160 });
      doc.font('Helvetica-Bold').text(value, R - 90, y, { width: 90, align: 'right' });
      y += 15;
      doc.moveTo(x, y - 3).lineTo(R, y - 3).lineWidth(last ? 1.5 : 0.6).strokeColor(last ? LIME : LINE).stroke();
      y += 3;
    };

    table('Monatlich wiederkehrende Dienstleistungen', rec.monthly || []);
    sumLine('Monatlicher Nettobetrag', eur(t.monthly), true);
    y += 10;
    table('Einmalige Dienstleistungen', rec.once || []);
    sumLine('Einmaliger Nettobetrag', eur(t.once));
    sumLine('Erster Abrechnungsmonat netto', eur(t.first));
    sumLine(`${t.vatPercent} % USt. (Standardfall Inland)`, eur(t.vat));
    sumLine('Erster Abrechnungsmonat brutto', eur(t.gross), true);
    sumLine('Wiederkehrender Jahreswert netto', eur(t.arr), false, true);
    y += 12;

    // Abgrenzung
    const fill = (txt) => String(txt || '').replace(/\{agb\}/g, config.termsUrl).replace(/\{firma\}/g, company.name);
    const notes = fill(rec.preview ? s.offerNotesPreview : s.offerNotesSigned);
    doc.font('Helvetica').fontSize(8);
    ensure(doc.heightOfString(notes, { width: W }) + 40);
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(LINE).stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('Leistungs- und Vertragsabgrenzung', L, y);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(notes, L, doc.y + 3, { width: W, lineGap: 1.5 });
    if (rec.notes) doc.moveDown(0.4).font('Helvetica-Bold').fillColor(INK).text('Zusatzanmerkungen: ', { continued: true }).font('Helvetica').fillColor(MUTED).text(rec.notes, { width: W });
    y = doc.y + 18;

    // Unterschrift
    if (!rec.preview && rec.signer) {
      ensure(140);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Beauftragung', L, y);
      y = doc.y + 6;
      try {
        doc.image(Buffer.from(rec.signature.split(',')[1], 'base64'), L, y, { fit: [230, 76] });
      } catch { /* ohne Bild */ }
      doc.moveTo(L, y + 80).lineTo(L + 230, y + 80).lineWidth(0.8).strokeColor(INK).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(`${rec.signer.name}${rec.signer.role ? `, ${rec.signer.role}` : ''}`, L, y + 84);
      doc.fillColor(MUTED).text(`für ${c.company} · unterschrieben am ${dt(rec.signedAt)}`, L, y + 96, { width: 260 });
      doc.fillColor(INK).text(`Aufgenommen von ${rec.seller?.name || ''}`, L + 290, y + 84, { width: W - 290 });
      doc.fillColor(MUTED).text(company.name, L + 290, y + 96, { width: W - 290 });
    }

    // Fußzeile
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      const foot = rec.preview
        ? 'Angebotsentwurf – unverbindlich, nicht unterschrieben'
        : `Elektronisch unterschrieben über das SIT-Cockpit · Prüfsumme ${String(rec.hash || '').slice(0, 32)}`;
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(`${foot}   ·   Seite ${i + 1} von ${range.count}`, L, doc.page.height - 36, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
