// Serverseitiger Token-Speicher: der persönliche weclapp-Token wird pro
// Microsoft-(Entra-)Account verschlüsselt abgelegt. Nach dem Microsoft-Login
// wird die Session daraus automatisch wiederhergestellt – auch nach "Abmelden",
// auf neuen Geräten oder wenn Cookies gelöscht wurden.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const file = path.join(config.dataDir, 'tokens.json');
fs.mkdirSync(config.dataDir, { recursive: true });

// Eigener Schlüssel (abgeleitet von SESSION_SECRET) – die Datei allein reicht nicht zum Entschlüsseln
const key = crypto.createHash('sha256').update('sit-time-token-store:' + config.sessionSecret).digest();

let db = {};
try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* neu */ }

function persist() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

function unseal(str) {
  try {
    const buf = Buffer.from(str, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null; // z.B. SESSION_SECRET geändert -> Token neu eingeben
  }
}

/** { token, userId, name, email } oder null */
export function getStored(entraId) {
  const e = entraId && db[entraId];
  return e ? unseal(e.data) : null;
}

export function saveStored(entraId, { token, userId, name, email }) {
  if (!entraId) return;
  db[entraId] = { data: seal({ token, userId, name, email }), savedAt: new Date().toISOString() };
  persist();
}

export function removeStored(entraId) {
  if (entraId && db[entraId]) { delete db[entraId]; persist(); }
}
