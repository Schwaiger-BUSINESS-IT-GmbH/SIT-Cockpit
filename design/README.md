# Design-Entwurf

`sit-cockpit-entwurf.dc.html` ist die Quelldatei des klickbaren Entwurfs aus einer Claude-Arbeitsfläche. Sie läuft **nicht eigenständig** im Browser, weil sie die Laufzeit der Arbeitsfläche (`support.js`) und dort gespeicherte Dateien (Logo unter `/_blob/…`) erwartet.

Verwendung: als Vorlage für den echten Bau. Aufbau, Texte, Farben, Beispieldaten und die gesamte Anzeige-Logik (Sortierung, Filter, Offline-Regeln, Leerzustände) stehen im Klartext in der Datei und können direkt übernommen werden.

Der Umschalter „Demo-Daten / Worst case / Je eins / Leer“ unten im Entwurf ist nur ein Testwerkzeug und gehört nicht in die echte Version.
