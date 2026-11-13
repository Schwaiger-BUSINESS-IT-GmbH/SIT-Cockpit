# KI-Arbeitsbericht

Der Techniker schreibt Stichwörter, die KI formuliert daraus einen Bericht, den der Kunde im Ticket und auf der Rechnung liest. Der Text wird vor dem Übernehmen immer vom Techniker geprüft.

## Regeln für die KI
- Sachlich und unpersönlich im **Passiv** („wurde deaktiviert“, „wurden eingerichtet“). Kein „wir“, kein „Sie“, keine Anrede, keine Grußformel.
- Stichwörter zu ganzen, verbundenen Sätzen ausformulieren („Dazu wurden …“, „Zusätzlich wurde …“).
- Produkt- und Fachbegriffe beibehalten und korrekt schreiben (Active Directory, Microsoft 365, Keeper). Abkürzungen beim ersten Vorkommen ausschreiben, z. B. „Active Directory (AD)“. Nicht zusätzlich erklären.
- **Nichts erfinden:** keine zusätzlichen Zahlen, Ursachen, Empfehlungen, Ergebnisse oder nächsten Schritte.
- Zusammengehöriges in einen Absatz, eigenständige Zusatzarbeiten in einen weiteren. Keine Aufzählung, kein Markdown.

## Stilbeispiel

**Stichwörter:**
Vororttermin, User Weber deaktiviert, User Wurzer angelegt und Profil auf Laptop angelegt, AD User, M365 User erstellt. Keeper User erstellt und alles Basismäßig eingerichtet.

**Bericht:**
Im Rahmen eines Vor-Ort-Termins wurde der bestehende Benutzer Weber deaktiviert und der neue Benutzer Wurzer eingerichtet. Dazu wurden ein Benutzerkonto im Active Directory (AD) sowie ein Microsoft-365-Konto erstellt und das Benutzerprofil am Laptop eingerichtet.
Zusätzlich wurde ein Keeper-Benutzerkonto angelegt und die erforderlichen Grundeinstellungen für die Nutzung vorgenommen.

## Umsetzung
- Prototyp: `prototypes/arbeitsbericht-assistent.html`. Läuft nur als Claude-Artifact (nutzt dessen KI-Zugang); lokal geöffnet erscheint ein Hinweis.
- Im echten Cockpit: Aufruf der Claude-API über das Backend, Stilbeispiele zentral für alle Techniker gepflegt. Weitere Beispiele aus anderen Arbeitsarten (Fehlerbehebung, Fernwartung) ergänzen.
