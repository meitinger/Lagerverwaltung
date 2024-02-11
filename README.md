# Lagerverwaltung

Mit dieser Webanwendung können zusätzliche Lager für einen [ready2order](https://ready2order.com/at/) Zugang angelegt und verwaltet werden.

Ebenso ist die Bearbeitung von Produkten mittels granularen Berechtigungen möglich.
Dabei erfolgt die Zuweisung der Berechtigungen zu Microsoft Entra Accounts, und es ist möglich, jede einzelne Produkteigenschaft getrennt voneinander als Berechtigung zuzuweisen.

Letztlich bietet die Anwendung die Erweiterungsfunktion, weitere Produkteigenschaften zu definieren, welche in einer eigenen Datenbank - aber verknüpft mit den ready2order Produkten - gespeichert werden.
Als Beispiel hierfür wurden Produktionskosten (`productionCosts`) implementiert.

Die Webanwendung ist auf Deutsch und Englisch verfügbar, weitere Sprachen können in [`strings.tsx`](https://github.com/meitinger/Lagerverwaltung/blob/main/src/strings.tsx) hinzugefügt werden. (PR sind willkommen :)

## Voraussetzungen

- ready2order Abonnement
- Microsoft Tenant
- Webserver mit PHP-Unterstützung (8.2 oder höher)
- MySQL Server (8.0.32 oder höher)

## Installation

1. ready2order Account Token [erstellen](https://ready2order.com/api/doc#section/Getting-started).
2. Single-Page-Application in Microsoft Entra [registrieren](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration):
    1. Folgende delegierte Berechtigungen hinzufügen und genehmigen:
        - `People.Read`
        - `Presence.Read.All`
        - `User.Read`
        - `User.ReadBasic.All`
    2. Anwendungsrollen mit Wert `Manage` und `Use` erstellen.
    3. Personen mit Verwaltungsfunktion der Rolle `Manage` zuweisen.
    4. Personen ohne Verwaltungsfunktion der Rolle `Use` zuweisen.
3. MySQL-Datenbank erstellen:
    1. Folgende Parameter bei der Erstellung verwenden:
        - `CHARACTER SET utf8mb4`
        - `COLLATE utf8mb4_bin` 
    2. [`db.sql`](https://github.com/meitinger/Lagerverwaltung/blob/main/db.sql) importieren.
3. Projekt mittels `npm run build` erstellen.
4. `build`-Ordner auf dem Webspace bereitstellen.
5. `config.php` anpassen:
    1. Unter `db` die MySQL-Datenbank Zugangsdaten eintragen.
    2. Unter `auth` die Microsoft Entra Tenant-ID und Anwendungs-Client-ID eintragen.
    3. Unter `api` die Pfade anpassen und den ready2order Account Token eintragen.
    4. Unter `webhook` die Pfade anpassen und eine zufällig generierte Zeichenfolge als `secret` eintragen.
    5. Unter `defaults` die Standardeinstellungen für neue Produkte eintragen.
6. Die vollständige Webhook-URL aufrufen:
    1. Beispiel: Wenn das `secret` im Punkt 5.4. auf `"123"` gesetzt wurde, dann `https://example.org/path/to/webhook.php?123` aufrufen.
    2. Überprüfen ob folgende Events aktiviert wurden:
        - `product.created`
        - `product.updated`
        - `product.deleted`
        - `productGroup.created`
        - `productGroup.updated`
        - `productGroup.deleted`
7. Die Anwendung aufrufen und als Verwaltungsperson anmelden.
    1. Im Datenbankmenü den Punkt *Server-Datenbank mit ready2order synchronisieren* wählen.
    2. Unter *Berechtigungen* den User Berechtigungen zu den Produktgruppen zuweisen.
    3. Unter *Lagerübersicht* neue Lager und erstellen und den User Berechtigungen zuweisen.
