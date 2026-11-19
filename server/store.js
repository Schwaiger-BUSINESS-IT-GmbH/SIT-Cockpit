// Timer-Speicher pro weclapp-User als JSON-Datei. Liegt serverseitig,
// damit ein Timer am Handy gestartet und am PC gestoppt werden kann.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const file = path.join(config.dataDir, 'timers.json');
fs.mkdirSync(config.dataDir, { recursive: true });

let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* neu */ }

let writing = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writing = writing.then(async () => {
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, file);
  }).catch((e) => console.error('Speichern fehlgeschlagen:', e));
  return writing;
}

function userBucket(userId) {
  const key = String(userId);
  db.users[key] ??= { timers: [], history: [] };
  return db.users[key];
}

export const isRunning = (t) => t.segments.length > 0 && t.segments.at(-1).end == null;

export function elapsedMs(t, now = Date.now()) {
  return t.segments.reduce((sum, s) => sum + ((s.end ?? now) - s.start), 0);
}

function view(t) {
  return { ...t, running: isRunning(t), elapsedMs: elapsedMs(t) };
}

function pauseAll(bucket, now) {
  for (const t of bucket.timers) if (isRunning(t)) t.segments.at(-1).end = now;
}

export function listTimers(userId) {
  const b = userBucket(userId);
  return { timers: b.timers.map(view), history: b.history.slice(0, 30), serverNow: Date.now() };
}

export async function startTimer(userId, ticket) {
  const b = userBucket(userId);
  const now = Date.now();
  pauseAll(b, now);
  let t = b.timers.find((x) => x.ticket.id === ticket.id);
  if (!t) {
    t = { id: crypto.randomUUID(), ticket, segments: [], note: '', createdAt: now };
    b.timers.unshift(t);
  }
  t.segments.push({ start: now, end: null });
  await persist();
  return view(t);
}

function find(userId, id) {
  const b = userBucket(userId);
  const t = b.timers.find((x) => x.id === id);
  if (!t) throw Object.assign(new Error('Timer nicht gefunden'), { status: 404 });
  return { b, t };
}

export async function pauseTimer(userId, id) {
  const { t } = find(userId, id);
  if (isRunning(t)) t.segments.at(-1).end = Date.now();
  await persist();
  return view(t);
}

export async function resumeTimer(userId, id) {
  const { b, t } = find(userId, id);
  if (!isRunning(t)) {
    const now = Date.now();
    pauseAll(b, now);
    t.segments.push({ start: now, end: null });
  }
  await persist();
  return view(t);
}

export async function updateNote(userId, id, note) {
  const { t } = find(userId, id);
  t.note = String(note ?? '').slice(0, 5000);
  await persist();
  return view(t);
}

export async function addPhoto(userId, id, photo) {
  const { t } = find(userId, id);
  t.photos = [...(t.photos || []), photo];
  await persist();
  return view(t);
}

export async function discardTimer(userId, id) {
  const { b } = find(userId, id);
  b.timers = b.timers.filter((x) => x.id !== id);
  await persist();
}

// Stoppt den Timer (Segment schließen) ohne ihn zu löschen – gebucht wird separat.
export async function stopTimer(userId, id) {
  const { t } = find(userId, id);
  if (isRunning(t)) t.segments.at(-1).end = Date.now();
  await persist();
  return view(t);
}

export async function completeTimer(userId, id, entry) {
  const b = userBucket(userId);
  b.timers = b.timers.filter((x) => x.id !== id);
  b.history.unshift(entry);
  b.history = b.history.slice(0, 100);
  await persist();
}

export function getTimer(userId, id) {
  return view(find(userId, id).t);
}
