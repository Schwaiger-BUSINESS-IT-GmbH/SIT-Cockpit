// Aktive weclapp-Verträge (für den Managed-Service-Umsatz).
// Die Vertragsverwaltung ist in weclapp nur für einzelne Benutzer lizenziert.
// Ist WECLAPP_CONTRACTS_TOKEN gesetzt, liest das Cockpit die Verträge mit diesem
// Token – AUSSCHLIESSLICH lesend und nur für diese eine Abfrage. Alle anderen
// weclapp-Abfragen laufen weiter mit dem Token des angemeldeten Benutzers.
// Vertrieb und Startseite bekommen nur Summen (Monatswert, Anzahl). Vertragsdetails
// gehen nur über /api/finance/contracts an die Entra-Gruppe Finanzen.
import { config } from './config.js';
import { request, unwrap } from './weclapp.js';

const PROPS = 'id,partyId,contractStatus,contractItems,contractCostItems,name,contractNumber,types,startDate,endDate,unlimited,latestPossibleTerminationDate,billingType';
let cache = { at: 0, rows: null };
let typeCache = { at: 0, rows: null };

/** Vertragstypen (Wartungsvertrag, Managed Service …) – gleicher Token wie die Verträge */
export async function contractTypes(userToken) {
  const service = config.weclappContractsToken;
  if (typeCache.rows && Date.now() - typeCache.at < 3600e3) return typeCache.rows;
  let raw;
  try { raw = unwrap(await request(service || userToken, 'GET', '/contractType', { query: { pageSize: 200 } })); } catch (e) {
    if (service && (e.status === 401 || e.status === 403)) throw Object.assign(new Error('Vertragstypen: Vertrags-Token wird von weclapp abgelehnt'), { status: 502 });
    throw e;
  }
  const rows = raw.map((t) => ({ id: String(t.id), name: t.name || `Typ ${t.id}`, active: t.active !== false }));
  typeCache = { at: Date.now(), rows };
  return rows;
}

export async function activeContracts(userToken) {
  const service = config.weclappContractsToken;
  if (service && cache.rows && Date.now() - cache.at < 600e3) return cache.rows;
  let rows;
  try {
    rows = unwrap(await request(service || userToken, 'GET', '/contract', {
      query: { 'contractStatus-eq': 'ACTIVE', pageSize: 1000, properties: PROPS },
    }));
  } catch (e) {
    // Ein abgelehnter Vertrags-Token darf den angemeldeten Benutzer NICHT abmelden
    // (401 vom Benutzer-Token führt sonst zum Logout) -> als eigener Fehler melden
    if (service && (e.status === 401 || e.status === 403)) {
      throw Object.assign(new Error('Vertrags-Token wird von weclapp abgelehnt – WECLAPP_CONTRACTS_TOKEN prüfen'), { status: 502 });
    }
    throw e;
  }
  if (service) cache = { at: Date.now(), rows };
  return rows;
}

export async function contractsOfParty(userToken, partyId) {
  return (await activeContracts(userToken)).filter((c) => String(c.partyId) === String(partyId));
}

export const usesServiceToken = () => Boolean(config.weclappContractsToken);
