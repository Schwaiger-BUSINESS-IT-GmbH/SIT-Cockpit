# SIT-Cockpit

Techniker-Oberfläche von Schwaiger Business IT. Sie zeigt auf einen Blick, was sich beim Kunden tut: Gerätezustand aus **Atera**, Tickets und Abrechnung aus **weclapp**.

**Stand:** klickbarer Design-Entwurf mit Beispieldaten. Noch keine echte Anbindung an Atera oder weclapp.

## Inhalt

| Ordner | Inhalt |
|---|---|
| `docs/konzept.md` | Architektur, Datenfluss, Schnittstellen, Sicherheit |
| `docs/anforderungen.md` | Fachliche Regeln und UI-Entscheidungen inkl. Ergebnisse aus Audit und Extremfall-Test |
| `docs/ki-arbeitsbericht.md` | Regeln und Stilbeispiel für die KI-Arbeitsberichte |
| `design/` | Design-Entwurf (Claude-Arbeitsfläche) als Vorlage für den echten Bau |
| `prototypes/arbeitsbericht-assistent.html` | Lauffähiger Prototyp: Stichwörter → kundentauglicher Bericht |
| `assets/` | Logos (Original und freigestellte Version für dunkle Flächen) |

## Grundsätze

1. **weclapp bleibt führend** für Tickets, Zeiten und Abrechnung. Das Cockpit liest und schreibt dorthin, hält aber keine eigenen Ticketdaten.
2. **Atera liefert die Gerätedaten** (Zustand, Ressourcen, Hardware, Backups). Tickets in Atera werden nicht mehr genutzt.
3. **Übersichtlich, nicht überfüllt:** Probleme zuerst, Details nur auf Klick.
4. **API-Schlüssel nur im Backend**, nie im Browser.

## Nächste Schritte

1. Backend aufsetzen (Node oder Python, Docker) mit Lesezugriff auf Atera- und weclapp-API.
2. Kundenzuordnung: weclapp-Kundennummer als Feld in Atera pflegen.
3. Frontend nach dem Entwurf in `design/` nachbauen, dabei die Punkte aus `docs/anforderungen.md` umsetzen.
4. Schreibende Funktionen: Ticket anlegen, Zeit buchen, Arbeitsbericht, Fotos.
5. Optional: kritische Atera-Alerts automatisch als weclapp-Ticket anlegen.

Empfohlene Umgebung für den Bau: Claude Code im Repository.
