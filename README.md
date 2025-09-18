# BLE-Scan-App – Fahrmodus (v1.3.0)

Neu:
- **Distanzschätzung** pro Paket über RSSI/txPower (Pfadverlust-Exponent n einstellbar, Default 2.0). Export in CSV/JSON als `distanceM`.
- **Fahrmodus-Feedback**: Live-Ticker + „Letztes Paket“-Zeit, Zähler/Ratemeter aktualisieren weiter. Ingestion läuft, UI-Rendering pausiert.
- **Cluster (5 s)**: hält stärkstes RSSI/txPower und berechnet min. Distanz im Fenster.
