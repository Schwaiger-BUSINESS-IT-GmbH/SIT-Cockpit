# Anforderungen und UI-Entscheidungen

## Gestaltung
- Stil angelehnt an LoginWatch: dunkle Seitenleiste, helle Inhaltsfläche, Kennzahl-Kacheln, Tabellen mit gesperrten Spaltenüberschriften.
- Farben Schwaiger Business IT: Anthrazit `#231F20`, Grün `#99CC33`. Auf grünen Flächen Schrift in Anthrazit (Weiß ist nicht lesbar).
- Ampelfarben (Rot/Orange/Grün) **nur für Gerätezustand**. Ticket-Status neutral in Grautönen mit Text. Grün sonst nur für Marke und Hauptaktionen.
- Mindestschriftgröße 12 px. Zahlen mit Tabellenziffern.
- Keine Animationen oder Überblendungen; Werkzeug ist ganztägig offen.
- Feste Farbvariablen und Dunkelmodus im echten Bau vorsehen.
- Logo: freigestellte Version `assets/sit-logo.png` auf dunklen Flächen; SVG-Version für den echten Bau besorgen.

## Fachliche Regeln
- **Offline-Bewertung:** Server, Firewall, Speicher nach 15 Min. offline = kritisch. Arbeitsplätze/Laptops nach 7 Tagen offline = Warnung.
- **Möglicher Ausfall:** Sind ≥ 50 % der Geräte eines Kunden (mind. 3) gleichzeitig offline, Hinweis „Möglicher Strom- oder Internetausfall“ anzeigen.
- **Kein Backup eingerichtet** zählt als Warnung.
- Seitenleiste: Zustandslabel nur bei Warnung/Kritisch.
- Pro Kunde ist beim Öffnen nur das dringendste Gerät aufgeklappt.

## Robustheit (Ergebnis Extremfall-Test)
- Leerzustände: keine Kunden/keine Daten von Atera, keine Tickets, keine Backups, keine Beschreibung, fehlender Ansprechpartner.
- Ticket mit gelöschtem Gerät: „In Atera nicht mehr vorhanden“ statt „kein Gerät verknüpft“.
- Lange Texte: Spalten mit festen Breiten, lange Gerätenamen (FQDN) umbrechen, Ticket-Betreff und Kundenname auf 2 Zeilen kürzen, voller Text als Tooltip.
- Große Mengen: Geräte in 50er-, Tickets in 25er-Schritten laden. Detaildaten (Diagramme) nur für aufgeklappte Geräte laden.
- Einzahl/Mehrzahl korrekt („1 Gerät“).
- Sonderzeichen (Umlaute, ś, ğ) korrekt darstellen.
