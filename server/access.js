// Rollen aus dem Microsoft-Login (App Service Easy Auth).
// Finanzen ist nur für Mitglieder der Entra-Gruppe FINANCE_GROUP_ID sichtbar –
// geprüft am Server bei jeder Anfrage, nicht nur in der Oberfläche.
//
// Easy Auth setzt X-MS-CLIENT-PRINCIPAL (Base64-JSON mit den Claims des ID-Tokens).
// Azure überschreibt diesen Header, er ist also nur vertrauenswürdig, wenn alle
// Anfragen durch Easy Auth laufen (REQUIRE_ENTRA=1). Lokal ohne Easy Auth wird
// der Header ignoriert; dann entscheidet FINANCE_LOCAL=1 (nur für Entwicklung).
import { config } from './config.js';

export function principalClaims(req) {
  const raw = req.get('x-ms-client-principal');
  if (!raw || !config.requireEntra) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return Array.isArray(p.claims) ? p.claims : null;
  } catch {
    return null;
  }
}

export function groupsOf(req) {
  const claims = principalClaims(req) || [];
  return claims.filter((c) => c.typ === 'groups' || c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups').map((c) => String(c.val));
}

export function isFinance(req) {
  if (config.demo) return true;
  if (config.requireEntra) return Boolean(config.financeGroupId) && groupsOf(req).includes(config.financeGroupId);
  return config.financeLocal; // lokale Entwicklung ohne Microsoft-Login
}

export function roles(req) {
  return { finance: isFinance(req) };
}

export function requireFinance(req, res, next) {
  if (isFinance(req)) return next();
  res.status(403).json({ error: 'Kein Zugriff auf Finanzen. Freigabe über die Entra-Gruppe „SIT-Cockpit Finanzen“.' });
}
