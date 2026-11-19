// Tickets aus Atera-Problemen direkt in weclapp anlegen.
// weclapp verlangt beim Anlegen Status, Priorität und Kanal. Die werden aus
// dem Mandanten gelesen und sinnvoll vorbelegt (überschreibbar per .env).
// Angelegte Tickets werden je Gerät/Problem gemerkt, damit am Problem
// "Ticket T-123" steht und nicht doppelt angelegt wird.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { request, unwrap } from './weclapp.js';

const get = (token, p, query) => request(token, 'GET', p, { query }).then(unwrap);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const closedRe = () => (config.hiddenStatusPattern ? new RegExp(config.hiddenStatusPattern, 'i') : /^$/);
const byPos = (a, b) => (Number(a.positionNumber) || 0) - (Number(b.positionNumber) || 0);

// ---------- gemerkte Verknüpfung Problem -> Ticket ----------
const linkFile = path.join(config.dataDir, 'atera-tickets.json');
const loadLinks = () => { try { return JSON.parse(fs.readFileSync(linkFile, 'utf8')); } catch { return {}; } };
const saveLinks = (l) => fs.writeFileSync(linkFile, JSON.stringify(l, null, 2));
export const problemKey = (deviceGuid, problem) => `${deviceGuid || 'kunde'}|${problem?.alertId || problem?.kind || 'allgemein'}`;
export function ticketLinks(customerId) {
  return Object.fromEntries(Object.entries(loadLinks()).filter(([, v]) => String(v.customerId) === String(customerId)));
}

// ---------- Stammdaten für den Dialog ----------
let metaCache = { at: 0, data: null };
export async function ticketMeta(token, userId) {
  if (!metaCache.data || Date.now() - metaCache.at > 600e3) {
    const [statuses, priorities, channels, users] = await Promise.all([
      get(token, '/ticketStatus', { pageSize: 200 }),
      get(token, '/ticketPriority', { pageSize: 200 }).catch(() => []),
      get(token, '/ticketChannel', { pageSize: 200 }).catch(() => []),
      get(token, '/user', { pageSize: 500, properties: 'id,firstName,lastName,username,email,status' }).catch(() => []),
    ]);
    const re = closedRe();
    const open = statuses.filter((s) => !re.test(s.name || '') && !config.hiddenTicketStatusIds.includes(String(s.id))).sort(byPos);
    const prios = priorities.filter((p) => p.active !== false).sort(byPos);
    const chans = channels.filter((c) => c.active !== false).sort(byPos);
    const name = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.email;
    // Vorbelegung: .env > Name > Reihenfolge
    // mehrere Muster nacheinander: das erste Muster mit Treffer gewinnt (stärkster Begriff zuerst)
    const find = (list, envId, ...res) => list.find((x) => String(x.id) === envId)
      || res.map((re2) => list.find((x) => re2.test(x.name || x.value || ''))).find(Boolean) || null;
    const high = find(prios, process.env.TICKET_PRIORITY_CRITICAL_ID, /kritisch|critical|dringend|urgent|sehr hoch|notfall/i, /hoch|high/i) || prios[prios.length - 1] || null;
    const normal = find(prios, process.env.TICKET_PRIORITY_WARNING_ID, /normal|mittel|medium/i) || prios[Math.floor(prios.length / 2)] || null;
    metaCache = {
      at: Date.now(),
      data: {
        statuses: open.map((s) => ({ id: String(s.id), name: s.name })),
        priorities: prios.map((p) => ({ id: String(p.id), name: p.name })),
        channels: chans.map((c) => ({ id: String(c.id), name: c.name || c.value })),
        users: users.filter((u) => !u.status || /active|aktiv/i.test(u.status)).map((u) => ({ id: String(u.id), name: name(u) })).sort((a, b) => a.name.localeCompare(b.name, 'de')),
        defaults: {
          statusId: String(find(open, process.env.TICKET_STATUS_ID, /^(offen|neu|new|open)$/i)?.id || open[0]?.id || ''),
          channelId: String(find(chans, process.env.TICKET_CHANNEL_ID, /monitoring|rmm|atera|system|intern/i)?.id || chans[0]?.id || ''),
          priorityCritical: String(high?.id || ''),
          priorityWarning: String(normal?.id || ''),
        },
      },
    };
  }
  return { ...metaCache.data, defaults: { ...metaCache.data.defaults, assignedUserId: String(userId || '') } };
}

/** Offene Tickets des Kunden, deren Betreff das Gerät nennt (Duplikat-Hinweis) */
export async function similarTickets(token, partyId, deviceName) {
  if (!partyId) return [];
  const statuses = await get(token, '/ticketStatus', { pageSize: 200 }).catch(() => []);
  const re = closedRe();
  const closed = statuses.filter((s) => re.test(s.name || '') || config.hiddenTicketStatusIds.includes(String(s.id))).map((s) => String(s.id));
  const names = Object.fromEntries(statuses.map((s) => [String(s.id), s.name]));
  const q = { 'partyId-eq': partyId, properties: 'id,ticketNumber,subject,ticketStatusId,lastModifiedDate', sort: '-lastModifiedDate', pageSize: 20 };
  if (closed.length) q['ticketStatusId-notin'] = JSON.stringify(closed);
  if (deviceName) q['subject-ilike'] = `%${deviceName}%`;
  const rows = await get(token, '/ticket', q).catch(() => []);
  return rows.map((t) => ({ id: String(t.id), number: t.ticketNumber, subject: t.subject, status: names[String(t.ticketStatusId)] || '', modified: t.lastModifiedDate }));
}

const toHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** Ticket anlegen */
export async function createTicket(token, body, session) {
  const partyId = str(body.partyId, 40);
  const subject = str(body.subject, 150);
  if (!partyId) throw bad('Kein weclapp-Kunde zugeordnet – Ticket kann nicht angelegt werden');
  if (subject.length < 3) throw bad('Bitte einen Betreff eingeben');
  const meta = await ticketMeta(token, session.userId);
  const statusId = str(body.statusId) || meta.defaults.statusId;
  const priorityId = str(body.priorityId) || meta.defaults.priorityWarning;
  const channelId = str(body.channelId) || meta.defaults.channelId;
  if (!statusId || !priorityId || !channelId) throw bad('In weclapp fehlen Ticketstatus, -priorität oder -kanal (Stammdaten prüfen)');
  const desc = `${str(body.description, 8000)}\n\n— angelegt von ${session.name} über das SIT-Cockpit${body.source?.alertId ? ` · Atera-Alert ${body.source.alertId}` : ''}`;
  const t = unwrap(await request(token, 'POST', '/ticket', {
    body: {
      partyId,
      subject,
      description: toHtml(desc),
      ticketStatusId: statusId,
      ticketPriorityId: priorityId,
      ticketChannelId: channelId,
      ...(body.assignedUserId ? { assignedUserId: str(body.assignedUserId, 40) } : {}),
      disableEmailTemplates: !body.notifyCustomer, // Standard: keine automatische Mail an den Kunden
    },
  }));
  const src = body.source || {};
  if (src.customerId) {
    const links = loadLinks();
    links[problemKey(src.deviceGuid, { alertId: src.alertId, kind: src.kind })] = {
      customerId: String(src.customerId), ticketId: String(t.id), number: t.ticketNumber, subject, createdAt: Date.now(), by: session.name,
    };
    saveLinks(links);
  }
  return { id: String(t.id), number: t.ticketNumber, subject };
}
