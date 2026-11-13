# Konzept SIT-Cockpit

## Systeme und Rollen

| System | Rolle im Cockpit |
|---|---|
| Atera | Quelle für Kunden, Geräte (Agents), Zustand, Alerts, Ressourcen, Hardware, Backups. Fernwartung bleibt in Atera. |
| weclapp | Führendes System für Tickets, Zeitbuchungen, Arbeitsberichte, Dokumente (Fotos) und Abrechnung. |
| SIT-Cockpit Backend | Hält die API-Schlüssel, holt und puffert Daten, schreibt in weclapp. |
| SIT-Cockpit Frontend | Weboberfläche für Techniker, Zugriff nur intern (Login oder VPN). |

## Datenfluss

```
Atera API ──(lesen, gepuffert)──┐
                                ├──> Backend ──> Frontend (Techniker)
weclapp API <──(lesen/schreiben)┘
```

- Daten werden kurz zwischengespeichert, damit nicht jeder Klick die APIs belastet.
- Kundenzuordnung über die **weclapp-Kundennummer**, die in Atera beim Kunden hinterlegt wird.

## Funktionen

### Kundenansicht
- Kennzahlen: Geräte online, Handlungsbedarf, offene Tickets, Zeit im Monat (weclapp).
- Geräte als aufklappbare Zeilen, Handlungsbedarf zuerst, unauffällige Geräte ausgeblendet.
- Aufgeklappt: Problem + zugehöriges Ticket, Aktionen (Fernwartung, Ticket), Kurzwerte (CPU, RAM, Laufwerke), darunter zugeklappte Bereiche Verlauf 24 Std., Zustand 28 Tage, Hardware.
- Backups: zusammengefasst, nur bei Problemen aufgeklappt.

### Alle Tickets
- Schnellfilter-Kacheln: Offen, In Arbeit, Wartet auf Kunde, Nicht zugewiesen.
- Filter: Suche, Status, Kunde, Techniker, Priorität.
- Ticket-Details: Beschreibung, betroffenes Gerät mit aktuellem Atera-Zustand, Arbeitsbericht mit KI, Fotos, Zeit buchen.

### Schreibende Aktionen (weclapp)
- Ticket anlegen (Kunde, Titel, Beschreibung, Priorität, Techniker, verknüpftes Gerät in eigenem Zusatzfeld).
- Zeit buchen, Status ändern.
- Arbeitsbericht übernehmen.
- Fotos als Dokumente an das Ticket hängen. Vor dem Upload verkleinern (Ziel 1–2 MB) und GPS-/EXIF-Daten entfernen. Dateiname: `<Ticketnr>_<Beschreibung>.jpg`.

> Die genauen weclapp-Endpunkte und Feldnamen (Ticket, Zeitbuchung, Dokument-Upload) vor dem Bau in der aktuellen API-Doku prüfen. Status, Prioritäten und Kategorien arbeiten mit instanzspezifischen IDs.

### Fernwartung
- Direktlink vom Gerät im Cockpit auf die Geräteseite in Atera; dort startet der Techniker die Sitzung.
- Ob ein Direktstart ohne Zwischenschritt möglich ist, hängt vom eingesetzten Fernwartungstool und der Atera-API ab. Vor dem Bau prüfen.
- Optional: Nach der Sitzung Zeitbuchung auf das offene Ticket zum Gerät anbieten.

### Automatik (optional)
- Kritische Atera-Alerts erzeugen ein weclapp-Ticket beim richtigen Kunden, einmal pro Problem (keine Duplikate bei wiederholten Alarmen).

## Sicherheit und Datenschutz
- API-Schlüssel nur im Backend, Zugriff nur für interne Techniker.
- KI-Arbeitsberichte: Ticketinhalte gehen an den KI-Anbieter, daher Auftragsverarbeitungsvertrag nötig. Keine Passwörter in Stichwörter.
- Fotos: Standortdaten vor dem Upload entfernen.
