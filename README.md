# SIT-Cockpit

Steuerzentrale von Schwaiger Business IT – vier Bereiche in einer App, ein Login:

| Bereich | Was es tut | Quelle |
|---|---|---|
| **Kunden & Geräte** | Ampel-Übersicht aller Kunden: Server offline, fehlgeschlagene Backups, kritische Alerts, volle Laufwerke, möglicher Strom-/Internetausfall. Probleme zuerst, Details auf Klick. | Atera |
| **Vertrieb & Finanzen** | Offene Angebote (inkl. „nachfassen“), angenommene Angebote, Managed-Service-Umsatz/Monat, offene Aufträge, überfällige Rechnungen, Auftragseingang 6 Monate, eigene Zeit im Monat. | weclapp |
| **Angebotsboard** | Am Tablet beim Kunden: Managed-Service-Pakete antippen, Mengen wählen, Preis live sehen, Kunde unterschreibt mit dem Finger → Angebot in weclapp (angenommen) + Auftrag + unterschriebenes PDF als Anhang. | weclapp |
| **Zeiten** | SIT-Time (Ticket-Zeiterfassung, Arbeitszeit) – eingebettet, gleicher Login. | weclapp |

## Schnellstart (Demo mit Beispieldaten)

Voraussetzung: Node.js ≥ 20.12

```bash
npm install
npm run demo        # http://localhost:3000  –  Login-Token: demo-rene
```

Atera und weclapp werden im Demo-Modus simuliert. Echte Systeme werden nicht berührt.

## Mit echten Daten

```bash
cp .env.example .env   # WECLAPP_TENANT, ATERA_API_KEY, SESSION_SECRET eintragen
npm start
```

**Vorbereitung in den Systemen**

1. **Atera:** API-Schlüssel unter *Admin → API* erzeugen → `ATERA_API_KEY`.
   Für die Verknüpfung mit weclapp ein Kunden-Zusatzfeld **„weclapp-Kundennummer“** anlegen und befüllen (sonst wird nach exaktem Firmennamen gesucht).
2. **weclapp:** Artikelkategorie **„Managed Services“** anlegen, die Managed-Service-Artikel zuordnen und jeweils einen Verkaufspreis (Preisliste NET1) pflegen. Einmalige Leistungen werden am Namen erkannt (Einrichtung, Setup, Onboarding …) oder in `config/angebotsboard.json` mit `"billing": "once"` markiert.
3. **Anmeldung:** jeder Mitarbeiter mit seinem persönlichen weclapp-API-Token (*Mein Profil → API*). Es gelten seine weclapp-Rechte, z. B. sieht nur, wer Rechnungen sehen darf, die Rechnungs-Kacheln.

## Angebotsboard im Detail

- Preise kommen immer aus weclapp und werden **am Server** berechnet. Der Browser schickt nur Artikel und Mengen.
- Laufzeiten, Laufzeit-Rabatte, maximaler Rabatt, Gruppierung, Reihenfolge und die Vertragstexte im PDF: `config/angebotsboard.json`.
- Ablauf beim Unterschreiben:
  1. Vorgang + Unterschrift werden **zuerst lokal gesichert** (`DATA_DIR/offers`). Eine Unterschrift geht nie verloren.
  2. Angebot in weclapp anlegen (Preise fix übernommen, Kommentar mit Unterzeichner/Zeitpunkt).
  3. PDF mit Unterschrift und Prüfsumme erzeugen, an das Angebot hängen.
  4. Angebot annehmen → weclapp erzeugt den Auftrag, PDF wird auch dort angehängt (`OFFER_CREATE_SALES_ORDER=0` = nur „angenommen“).
- Ist weclapp nicht erreichbar, bleibt der Vorgang gespeichert und kann unter *Vertrieb & Finanzen → Am Tablet unterschrieben* erneut gesendet werden.

## Ampel-Regeln (siehe `docs/anforderungen.md`)

| Situation | Bewertung |
|---|---|
| Server/Domain Controller ≥ 15 Min. offline | kritisch |
| Arbeitsplatz ≥ 7 Tage offline | Warnung |
| Atera-Alert *Critical* / *Warning* | kritisch / Warnung |
| Laufwerk < 10 % / < 5 % frei | Warnung / kritisch |
| ≥ 50 % der Geräte (mind. 3) gleichzeitig vor Kurzem offline gegangen | kritisch, Hinweis „Möglicher Strom- oder Internetausfall“ |
| Alert mit Backup/Veeam/Acronis… im Titel | als Backup-Problem gezählt |

Atera-Daten werden zentral alle 3 Minuten geholt und zwischengespeichert (`ATERA_REFRESH_SECONDS`).

## Tests

```bash
npm test
```

## Betrieb in Azure

Gleiche Architektur wie SIT-Time: Azure App Service (Linux, Node 22) + Microsoft-Login (Easy Auth) + GitHub-Actions-Deployment.

```powershell
.\infra\1-setup-azure.ps1 -WeclappTenant <mandant> -GitHubRepo <org>/SIT-Cockpit -AteraApiKey <schlüssel>
.\infra\2-custom-domain.ps1 -Hostname cockpit.schwaiger-it.at          # CNAME + TXT anzeigen
.\infra\2-custom-domain.ps1 -Hostname cockpit.schwaiger-it.at -Bind    # nach DNS-Eintrag
```

Jeder Push auf `main` deployt danach automatisch. Daten (Tokens, Timer, unterschriebene Vorgänge) liegen unter `/home/data`. **Nur eine Instanz betreiben** (Dateispeicher).

Alternativ Docker: `docker compose up -d --build`.

## Aufbau

```
server/
  index.js         Express-Server, Login, REST-API
  atera.js         Atera-Client, Ampel-Regeln, Hintergrund-Cache
  sales.js         weclapp: Dashboard-Kennzahlen, Kunden
  offers.js        Angebotsboard: Katalog, Berechnung, Unterschrift → weclapp
  pdf.js           PDF mit Unterschrift
  weclapp.js       weclapp-Client (aus SIT-Time)
  time-routes.js   SIT-Time-Routen (Timer, Buchung, Arbeitszeit)
  mock/            Atera- und weclapp-Simulation für den Demo-Modus
config/angebotsboard.json   Feinsteuerung Angebotsboard
public/            Cockpit-Oberfläche (ohne Build-Schritt)
public/zeiten/     SIT-Time-Oberfläche
docs/ design/      Konzept, Anforderungen, Design-Entwurf
```
