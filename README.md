# SIT-Cockpit

Steuerzentrale von Schwaiger Business IT – vier Bereiche in einer App, ein Login:

| Bereich | Was es tut | Quelle |
|---|---|---|
| **Kunden & Geräte** | Ampel-Übersicht aller Kunden: Server offline, fehlgeschlagene Backups, kritische Alerts, volle Laufwerke, möglicher Strom-/Internetausfall. Probleme zuerst, Details auf Klick. | Atera |
| **Vertrieb & Finanzen** | Offene Angebote (inkl. „nachfassen“), angenommene Angebote, Managed-Service-Umsatz/Monat, offene Aufträge, überfällige Rechnungen, Auftragseingang 6 Monate, eigene Zeit im Monat. | weclapp |
| **Angebotsboard** | Kunden-Onboarding am Tablet (Gestaltung nach *SIT_Angebotsboard_V4*): Erstaufnahme mit IT-Umgebung, interne Einstufung, Zusatz-SLA + Managed-Service-Katalog mit Staffelpreisen und Leistungsbeschreibungen, Angebotsvorschau, Unterschrift mit dem Finger → (Neu-)Kunde, Angebot (angenommen), Auftrag und PDF in weclapp, danach Onboarding-Checkliste. Umschaltbare Kundenansicht ohne interne Daten. | weclapp |
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

1. **Atera:** API-Schlüssel unter *Admin → API* erzeugen → `ATERA_API_KEY`. Neue Schlüssel (JWT, ab der Umstellung 12/2026) sendet das Cockpit automatisch als `Authorization: Bearer`, alte weiterhin als `X-API-KEY`. Benötigte Rechte: Customers, Agents, Alerts, CustomValues.
   Für die Verknüpfung mit weclapp ein Kunden-Zusatzfeld **„weclapp-Kundennummer“** anlegen und befüllen (sonst wird nach exaktem Firmennamen gesucht).
2. **weclapp:** Für jede Artikelnummer (`sku`) aus `config/angebotsboard.json` einen Artikel mit gleicher Artikelnummer anlegen – die zehn Produkte, die SLA-Artikel (`SIT-SLA-…`, `SIT-GOV-…`) und `SIT-PROJEKT`. Fehlende Artikel zeigt das Board intern rot an.
3. **Anmeldung:** jeder Mitarbeiter mit seinem persönlichen weclapp-API-Token (*Mein Profil → API*). Es gelten seine weclapp-Rechte, z. B. sieht nur, wer Rechnungen sehen darf, die Rechnungs-Kacheln.

**Prüfung vor dem Echtbetrieb** (nur lesend, schreibt nichts in weclapp oder Atera):

```powershell
$env:WECLAPP_TOKEN="<dein-token>"; npm run check
```

Prüft Anmeldung, API-Schema des Mandanten (alle Felder, Endpunkte und Statuswerte, die das Cockpit nutzt), deine Leserechte je Cockpit-Bereich, welcher Ticketstatus als „geschlossen“ gilt, ob alle Artikel des Angebotsboards in weclapp existieren, Atera-Zugriff, Gerätetypen, `LastSeen`, offene Alerts sowie die Zuordnung Atera-Kunde → weclapp-Kunde. Ergebnis mit ✔ / ⚠ / ✖; bei Fehlern Exit-Code 1.

## Angebotsboard im Detail

Ablauf in sechs Schritten: **Kundendaten** (weclapp-Kunde suchen oder Neukunde, IT-Umgebung) → **Interne Einstufung** (Gold/Silber/Bronze/Registered, nur intern) → **Serviceauswahl** (Zusatz-SLA, IT-Review, Katalog, Projektposition) → **Angebot** (Vorschau, PDF) → **Unterschrift** → **Onboarding** (Checkliste je Auftrag).

- **Katalog, Preise, Staffeln, Leistungsbeschreibungen, SLA-Modell, Checkliste und Vertragstexte** stehen in `config/angebotsboard.json` (übernommen aus SIT_Angebotsboard_V4). Preise werden **am Server** berechnet, der Browser schickt nur Auswahl und Mengen.
- **Prüfpunkte** (Leistungsüberschneidungen, fehlende Leistungsbeschreibungen, Entwurfs-SLA-Preise, Servicezeiten …) sind nur intern sichtbar. Solange welche offen sind, muss im Schritt „Angebot“ *Intern geprüft* bestätigt werden, sonst ist keine Unterschrift möglich.
- **Kundenansicht** blendet Cockpit-Navigation, interne Einstufung, Quellen und Prüfpunkte aus – zum Übergeben des Tablets.
- **Kundenstand speichern / Gespeicherte laden:** Entwürfe liegen am Server (`DATA_DIR/offers/drafts`), für alle Mitarbeiter sichtbar.
- **Beim Unterschreiben:**
  1. Vorgang + Unterschrift werden **zuerst lokal gesichert** (`DATA_DIR/offers`). Eine Unterschrift geht nie verloren.
  2. Neukunde wird in weclapp angelegt (falls nicht ausgewählt).
  3. Angebot in weclapp mit fixen Preisen und Leistungsbeschreibung je Position, PDF mit Unterschrift und Prüfsumme angehängt.
  4. Angebot annehmen → Auftrag, PDF auch dort (`OFFER_CREATE_SALES_ORDER=0` = nur „angenommen“).
- Scheitert weclapp (z. B. fehlender Artikel), bleibt der Vorgang gespeichert und kann erneut gesendet werden – im Board oder unter *Vertrieb & Finanzen*.

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
  offers.js        Angebotsboard: Katalog, Berechnung, Entwürfe, Unterschrift → weclapp
  pdf.js           PDF mit Unterschrift
  weclapp.js       weclapp-Client (aus SIT-Time)
  time-routes.js   SIT-Time-Routen (Timer, Buchung, Arbeitszeit)
  mock/            Atera- und weclapp-Simulation für den Demo-Modus
config/angebotsboard.json   Feinsteuerung Angebotsboard
public/            Cockpit-Oberfläche (ohne Build-Schritt), board.js/.css = Angebotsboard
public/zeiten/     SIT-Time-Oberfläche
docs/ design/      Konzept, Anforderungen, Design-Entwurf
```
