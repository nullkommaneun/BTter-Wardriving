# BLE-Scan-App – Fahrmodus

Statische Webapp für GitHub Pages. Keine Server-Komponenten. Unterstützt Web Bluetooth BLE-Scan, Geolocation, Fahrmodus, Karte (Leaflet), Filter, Cluster (5 s), Export (JSON/CSV), IndexedDB.

## Schnellstart
1. Repository erstellen, Dateien pushen.
2. GitHub Pages aktivieren (Source: `main` / root). Nur über **HTTPS** nutzen.
3. In Chrome/Android Berechtigungen erlauben, „Scan starten“. 

## Hinweise
- Web Bluetooth Scan ist experimentell und nicht in allen Browsern/Plattformen verfügbar.
- Fahrmodus pausiert das Rendering (Tabelle/Karte); Zähler laufen weiter. Beim Zurückschalten wird UI synchronisiert und Karte auf Daten gezoomt.
- CSV exportiert `serviceUUIDs` als Semikolon-Liste; Schema entspricht dem JSON-Format.
