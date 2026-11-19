// Stateless Session: persönlicher weclapp-Token + User-Info, AES-256-GCM
// verschlüsselt im HttpOnly-Cookie. Der Token landet nie im Browser-JS.
import crypto from 'node:crypto';
import { config } from './config.js';
import { getStored } from './tokens.js';

const COOKIE = 'sit_session';
const MAX_AGE_DAYS = 30;
const key = crypto.createHash('sha256').update(config.sessionSecret).digest();

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
    const obj = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
    return obj.exp > Date.now() ? obj : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSession(res, data) {
  const exp = Date.now() + MAX_AGE_DAYS * 864e5;
  res.cookie(COOKIE, seal({ ...data, exp }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: MAX_AGE_DAYS * 864e5,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireSession(req, res, next) {
  const s = readCookie(req, COOKIE);
  let session = s && unseal(s);
  // Session an den Microsoft-Login (App Service Easy Auth) binden:
  // meldet sich am selben Gerät ein anderer Entra-User an, gilt die Session nicht.
  const entra = entraPrincipal(req);
  if (session && session.entraId && session.entraId !== entra?.id) session = null;
  // Kein gültiges Cookie -> aus dem serverseitigen Token-Speicher wiederherstellen
  if (!session && entra) {
    const stored = getStored(entra.id);
    if (stored) {
      session = { ...stored, entraId: entra.id };
      setSession(res, session);
    }
  }
  if (!session) return res.status(401).json({ error: 'Nicht angemeldet' });
  req.session = session;
  next();
}

// Von App Service Easy Auth gesetzte Header (werden von Azure überschrieben,
// können also vom Client nicht gefälscht werden, solange Easy Auth aktiv ist).
export function entraPrincipal(req) {
  const id = req.get('x-ms-client-principal-id');
  if (!id) return null;
  return { id, name: req.get('x-ms-client-principal-name') || '' };
}

// Optionaler Schutz: ohne Easy-Auth-Header gar nichts ausliefern (REQUIRE_ENTRA=1)
export function requireEntraIfConfigured(req, res, next) {
  if (!config.requireEntra || req.path === '/healthz' || entraPrincipal(req)) return next();
  res.status(403).send('Zugriff nur über Microsoft-Anmeldung');
}
