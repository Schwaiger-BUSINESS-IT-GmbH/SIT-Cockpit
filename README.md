# SIT-Cockpit

Steuerzentrale von Schwaiger Business IT – vier Bereiche in einer App, ein Login:

| Bereich | Was es tut | Quelle |
|---|---|---|
| **Kunden & Geräte** | Ampel-Übersicht über **Server und Firewalls** aller Kunden: Server offline, Firewall nicht erreichbar, fehlgeschlagene Backups, kritische Alerts, volle Laufwerke, möglicher Strom-/Internetausfall. Probleme zuerst, Details auf Klick. Meldungen je Kunde oder Gerät pausierbar. | Atera |
| **Vertrieb & Finanzen** | Offene Angebote (inkl. „nachfassen“), angenommene Angebote, Managed-Service-Umsatz/Monat, offene Aufträge, überfällige Rechnungen, Auftragseingang 6 Monate, eigene Zeit im Monat. | weclapp |
| **Angebotsboard** | Kunden-Onboarding am Tablet (Gestaltung nach *SIT_Angebotsboard_V4*): Erstaufnahme mit IT-Umgebung, interne Einstufung, Zusatz-SLA + Managed-Service-Katalog mit Staffelpreisen und Leistungsbeschreibungen, Angebotsvorschau, Unterschrift mit dem Finger → (Neu-)Kunde, Angebot (angenommen), Auftrag und PDF in weclapp, danach Onboarding-Checkliste. Umschaltbare Kundenansicht ohne interne Daten. | weclapp |
| **Backups** | Wochentabelle je Kunde (Mo–So, je Sicherungsnacht ✓ / ✗ / !) aus den Atera-Ereignisprotokoll-Meldungen (z. B. Veeam, Ereignis-ID 190), Woche vor/zurück (8 Wochen). Zeile aufklappen: Ereignisse mit Gerät, Ereignis-ID, Job und ausklappbarer Beschreibung. Letzte Nacht fehlgeschlagene Sicherungen auf der Startseite. | Atera |
| **Security** | Sicherheitsmeldungen von Fortinet, Microsoft (Patchday je Produkt), Synology, Veeam, 3CX u. a. mit CVEs, CVSS, EPSS und „aktiv ausgenutzt“ (CISA KEV); betroffene Kunden aus den Atera-Geräten; Bearbeitungsstatus je Meldung; aus einer Meldung je betroffenem Kunden ein weclapp-Ticket anlegen. Produktliste in `config/security.json`. | CISA, Hersteller, NVD, FIRST, Atera |
| **Zeiten** | SIT-Time (Ticket-Zeiterfassung, Arbeitszeit) – die eigene App `time.schwaiger-it.at` eingebettet, immer aktuell, dieselben Timer wie am Handy. | SIT-Time |

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
   **Kunden verknüpfen:** im Cockpit unter *Kunden & Geräte → Kundenzuordnung weclapp* (Vorschläge über unscharfen Namensvergleich, Suche, gespeichert in `DATA_DIR/customer-map.json`). Alternativ oder zusätzlich das Atera-Kundenfeld **„weclapp-Kundennummer“** befüllen. Reihenfolge: Cockpit-Zuordnung → Atera-Feld → exakt gleicher Firmenname.
2. **weclapp-Artikel zuordnen:** Die Artikelnummern in `config/angebotsboard.json` sind Board-interne Kennungen. Im Angebotsboard unter **Artikelzuordnung** jede Position mit dem echten weclapp-Artikel verknüpfen: *Vorschläge suchen* (über den Namen) → übernehmen, Rest über die Suche. Gespeichert in `DATA_DIR/article-map.json`. Preisabweichungen weclapp ↔ Board werden angezeigt; im Angebot gilt der Board-Preis, im PDF steht die weclapp-Artikelnummer. Positionen, die (noch) nicht verkauft werden, können offen bleiben.
3. **Anmeldung:** jeder Mitarbeiter mit seinem persönlichen weclapp-API-Token (*Mein Profil → API*). Es gelten seine weclapp-Rechte, z. B. sieht nur, wer Rechnungen sehen darf, die Rechnungs-Kacheln.

**Prüfung vor dem Echtbetrieb** (nur lesend, schreibt nichts in weclapp oder Atera):

```powershell
$env:WECLAPP_TOKEN="<dein-token>"; npm run check
```

Prüft Anmeldung, API-Schema des Mandanten (alle Felder, Endpunkte und Statuswerte, die das Cockpit nutzt), deine Leserechte je Cockpit-Bereich, welcher Ticketstatus als „geschlossen“ gilt, ob alle Artikel des Angebotsboards in weclapp existieren, Atera-Zugriff, Gerätetypen, `LastSeen`, offene Alerts sowie die Zuordnung Atera-Kunde → weclapp-Kunde. Ergebnis mit ✔ / ⚠ / ✖; bei Fehlern Exit-Code 1.

## Managed-Service-Umsatz (Verträge)

Die Vertragsverwaltung ist in weclapp nur für einzelne Benutzer lizenziert. Damit alle den Managed-Service-Umsatz sehen, kann in Azure die App-Einstellung **`WECLAPP_CONTRACTS_TOKEN`** mit dem API-Token eines lizenzierten Benutzers gesetzt werden. Das Cockpit nutzt ihn **nur zum Lesen der aktiven Verträge** (10 Minuten gepuffert); an den Browser gehen ausschließlich Summen (Monatswert, Anzahl), nie Vertragsdetails oder der Token. Ein abgelehnter Token meldet einen eigenen Fehler und meldet niemanden ab. Ohne Einstellung gelten die Rechte des angemeldeten Benutzers. Ausnahme: Unter **Finanzen › Wartungsverträge** (nur Entra-Gruppe Finanzen) sieht die Geschäftsführung die Verträge im Detail.

**Finanzen › Wartungsverträge** zeigt je Kunde die aktiven Verträge, die Kunden ohne Vertrag (Rechnungen der letzten 12 Monate, Zeitbuchungen oder in Atera verwaltet) und die Rentabilität. Gerechnet wird so: Ertrag (Vertragswert anteilig) − Lizenzkosten (Kostenpositionen im Vertrag, sonst Einkaufspreis des Artikels) − Stunden × interner Stundensatz (`INTERNAL_HOURLY_COST`, Standard 60 €/h). Standardmäßig zählen nur nicht verrechenbare Stunden, und bei neuen Verträgen erst ab Vertragsbeginn.

## Ticket aus einem Problem

In der Kundenansicht hat jedes Problem (Server/Firewall offline, Alert, Backup, Laufwerk, möglicher Ausfall) einen Knopf **„Ticket erstellen“**, dazu einer im Kundenkopf. Der Dialog ist vorausgefüllt: Betreff „Gerät: Problem“, Beschreibung mit Gerätedaten und Atera-Link, Priorität nach Ampel (kritisch → höchste Priorität), Bearbeiter = angemeldeter Benutzer, erster offener Status, Kanal „Monitoring“ (falls vorhanden). Alles änderbar.

- Die **automatische Kunden-E-Mail** von weclapp ist standardmäßig aus (`disableEmailTemplates`), per Häkchen zuschaltbar.
- **Doppelte Tickets:** Der Dialog zeigt offene Tickets des Kunden zum Gerät an. Angelegte Tickets werden am Problem als „Ticket T-…“ angezeigt (gespeichert in `DATA_DIR/atera-tickets.json`).
- **Meldungen pausieren:** am Kunden („Kunde pausieren“) oder am Gerät („Meldungen pausieren“), mit Dauer (4 Std. bis 1 Monat, „bis behoben“ = endet automatisch, sobald alles wieder in Ordnung ist, oder unbefristet) und Grund. Pausierte Probleme bleiben grau sichtbar, zählen aber nicht als kritisch/Warnung und erscheinen nicht unter „Braucht Aufmerksamkeit“. Alle aktiven Pausen stehen unten in der Kundenübersicht (gespeichert in `DATA_DIR/atera-pauses.json`).
- Voraussetzung: Der Atera-Kunde ist einem weclapp-Kunden zugeordnet.
- Vorbelegung fest einstellen (optional): `TICKET_STATUS_ID`, `TICKET_CHANNEL_ID`, `TICKET_PRIORITY_CRITICAL_ID`, `TICKET_PRIORITY_WARNING_ID`.

## Angebotsboard im Detail

Ablauf in sechs Schritten: **Kundendaten** (weclapp-Kunde suchen oder Neukunde, IT-Umgebung) → **Interne Einstufung** (Gold/Silber/Bronze/Registered, nur intern) → **Serviceauswahl** (Zusatz-SLA, IT-Review, Katalog, Projektposition) → **Angebot** (Vorschau, PDF) → **Unterschrift** → **Onboarding** (Checkliste je Auftrag).

- **Katalog, Preise, Staffeln, Leistungsbeschreibungen, SLA-Modell, Checkliste und Vertragstexte** stehen in `config/angebotsboard.json` (übernommen aus SIT_Angebotsboard_V4). Preise werden **am Server** berechnet, der Browser schickt nur Auswahl und Mengen.
- **Prüfpunkte** (Leistungsüberschneidungen, fehlende Leistungsbeschreibungen, Entwurfs-SLA-Preise, Servicezeiten …) sind nur intern sichtbar. Solange welche offen sind, muss im Schritt „Angebot“ *Intern geprüft* bestätigt werden, sonst ist keine Unterschrift möglich.
- **Deutsch / Englisch:** Umschalter DE | EN in der Kopfleiste (auch in der Kundenansicht). Englisch sind Board, Angebot, PDF und die Positionstexte in weclapp; interne Bereiche bleiben deutsch. Englische Produkt-, SLA- und Vertragstexte: `config/angebotsboard.en.json` (Preise kommen immer aus `angebotsboard.json`).
- **Kundenansicht** blendet Cockpit-Navigation, interne Einstufung, Quellen und Prüfpunkte aus – zum Übergeben des Tablets.
- **Kundenstand speichern / Gespeicherte laden:** Entwürfe liegen am Server (`DATA_DIR/offers/drafts`), für alle Mitarbeiter sichtbar.
- **Beim Unterschreiben:**
  1. Vorgang + Unterschrift werden **zuerst lokal gesichert** (`DATA_DIR/offers`). Eine Unterschrift geht nie verloren.
  2. Neukunde wird in weclapp angelegt (falls nicht ausgewählt).
  3. Angebot in weclapp mit fixen Preisen und Leistungsbeschreibung je Position, PDF mit Unterschrift und Prüfsumme angehängt.
  4. Angebot annehmen → Auftrag, PDF auch dort (`OFFER_CREATE_SALES_ORDER=0` = nur „angenommen“).
- Scheitert weclapp (z. B. fehlender Artikel), bleibt der Vorgang gespeichert und kann erneut gesendet werden – im Board oder unter *Vertrieb & Finanzen*.

## Ampel-Regeln

Die Übersicht zeigt **nur Server und Firewalls**. Arbeitsplätze, Drucker, Switches usw. und deren Alerts werden ausgeblendet, Kunden ohne Server/Firewall erscheinen nicht.

| Situation | Bewertung |
|---|---|
| Server/Domain Controller ≥ 15 Min. offline | kritisch |
| Server länger als 30 Tage offline (`STALE_SERVER_DAYS`) | *veraltet* – kein Alarm, grau als Aufräum-Hinweis |
| Firewall nicht erreichbar (SNMP) | kritisch |
| Atera-Alert *Critical* / *Warning* an Server oder Firewall | kritisch / Warnung |
| Laufwerk < 10 % / < 5 % frei (Server) | Warnung / kritisch |
| Firewall nicht erreichbar und Server gleichzeitig vor Kurzem offline | kritisch, Hinweis „Möglicher Strom- oder Internetausfall“ |
| Alert mit Backup/Veeam/Acronis… im Titel | als Backup-Problem gezählt |

**Firewalls** kommen aus den Atera-Netzwerkgeräten: SNMP-Geräte vom Typ „Firewall“ (mit Online-Status) sowie Ping-/TCP-/HTTP-Geräte mit typischem Namen (Firewall, FortiGate, Sophos …) – Letztere nur über ihre Alerts.

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

**Live:** https://cockpit.schwaiger-it.at (Web-App `sit-cockpit-schwaiger` auf dem SIT-Time-Plan in `rg-sit-time`, Microsoft-Login davor). Für das kostenlose Zertifikat muss die CAA-Liste von `schwaiger-it.at` **`digicert.com`** erlauben (bei A1 ergänzt).

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
  weclapp.js       weclapp-Client (ursprünglich aus SIT-Time)
  mock/            Atera- und weclapp-Simulation für den Demo-Modus
config/angebotsboard.json   Feinsteuerung Angebotsboard
public/            Cockpit-Oberfläche (ohne Build-Schritt), board.js/.css = Angebotsboard
docs/ design/      Konzept, Anforderungen, Design-Entwurf
```

### Zeiten (SIT-Time)

SIT-Time ist eine eigene App (`https://time.schwaiger-it.at`, Repo `SIT-Time`) und wird unter `#/zeiten` nur **eingebettet** (iframe) – keine Kopie im Cockpit. Damit ist das Cockpit immer auf dem Stand von SIT-Time, und Timer/Arbeitszeit sind dieselben wie am Handy.

- Adresse per `TIME_URL` (Standard `https://time.schwaiger-it.at`, im Demo-Modus `http://localhost:3100`).
- SIT-Time erlaubt das Einbetten nur für `EMBED_ORIGINS` (dort Standard `https://cockpit.schwaiger-it.at`) und gibt dem Cockpit lesend die eigenen Timer für die Startseiten-Kachel frei. Beides funktioniert, weil `cockpit.` und `time.schwaiger-it.at` dieselbe Site sind (Cookies werden im iframe mitgeschickt).
- Die Microsoft-Anmeldung lässt sich nicht einbetten. Ist sie bei SIT-Time abgelaufen, zeigt das Cockpit „SIT-Time meldet sich nicht“ mit **Bei SIT-Time anmelden** (kleines Popup); läuft sie während der Arbeit ab, bietet SIT-Time selbst das Popup an.
- Lokal testen: SIT-Time mit `PORT=3100 EMBED_ORIGINS=http://localhost:3000 npm run demo`, Cockpit mit `npm run demo`.

### Backups

- Quelle: Atera-Alerts der Ereignisprotokoll-Überwachung (Titel „Ereignisprotokoll: Veeam Backup | Ereignis-ID: 190“, Beschreibung im Meldungstext) sowie andere Alerts mit Backup/Sicherung/Veeam im Titel. Atera liefert die Historie (neueste zuerst); das Cockpit sammelt die Backup-Ereignisse in `DATA_DIR/backup-events.json` (8 Wochen) und holt alle 15 Min. Neues (`BACKUP_REFRESH_MINUTES`).
- Spalte = Sicherungsnacht: Ereignisse vor 12 Uhr zählen zur Nacht davor (`BACKUP_DAY_CUTOFF_HOUR`). Je Job zählt das letzte Ergebnis der Nacht (ein erfolgreicher Retry hebt den Fehler auf).
- **Wichtig:** Die Atera-Überwachung meldet derzeit nur Fehlschläge. Ein grüner Haken heißt deshalb „kein Fehler gemeldet“. Wird in Atera für Ereignis-ID 190 zusätzlich die Stufe „Information“ überwacht, kommen auch Erfolge an: dann gibt es echte Haken, und fehlt bei so einem Kunden eine Meldung, zeigt die Tabelle „?“.

### Security-Seite

- Quellen sind öffentlich und brauchen keine Schlüssel: CISA KEV, Fortinet PSIRT (RSS + CSAF), Microsoft Security Update Guide, Synology Advisories, NVD, FIRST EPSS. Optional `NVD_API_KEY` für ein höheres NVD-Limit.
- Abruf alle 3 Stunden im Hintergrund (`SEC_REFRESH_HOURS`), „Neu abrufen“ auf der Seite holt sofort.
- Welche Produkte wir einsetzen, steht in `config/security.json` (Hersteller, Muster für Meldungen und Atera-Geräte, `inUse` für Produkte ohne Atera-Erfassung wie Veeam oder 3CX). Weitere Produkte über `nvd` (Stichwortsuche) ergänzen.
- „Tickets anlegen“ an einer Meldung: je ausgewähltem Kunden ein weclapp-Ticket (Betreff, Beschreibung mit CVEs/Lösung, betroffene Geräte aus Atera). Voraussetzung ist die Kundenzuordnung Atera → weclapp. Angelegte Tickets stehen am Kunden der Meldung und werden nicht doppelt angelegt; die Meldung springt auf „In Arbeit“.
- Bearbeitungsstatus liegt in `DATA_DIR/security-status.json`, die Ticket-Verknüpfungen in `security-tickets.json`, die gesammelten Fortinet-Meldungen in `security-fortinet.json` (alles in der nächtlichen Sicherung).
