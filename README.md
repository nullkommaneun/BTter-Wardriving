# BLE-Scan-App – Fahrmodus (v1.2.0)

Neu:
- Zusätzliche Felder: `txPower`, `manufacturerData` (roh hex), `serviceData` (roh hex).
- Decoder: **iBeacon** (0x004C), **Eddystone-URL/TLM** (0xFEAA) → Zusatzfelder in Exporten.
- Fahrmodus mit **WakeLock** (Bildschirm bleibt an; auto-reacquire bei Rückkehr in den Vordergrund).
- CSV-Exporte enthalten Roh- und decodierte Felder; Cluster (5 s) mit `count`.
