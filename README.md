# RedMatic Matter

[![NPM version](https://badge.fury.io/js/redmatic-matter.svg)](http://badge.fury.io/js/redmatic-matter)
[![CI](https://github.com/rdmtc/RedMatic-Matter/actions/workflows/ci.yml/badge.svg)](https://github.com/rdmtc/RedMatic-Matter/actions/workflows/ci.yml)

> Node-RED-Nodes, die Homematic-Geräte und beliebige Node-RED-Daten als
> **Matter-Bridge** bereitstellen, auf Basis von
> [matter.js](https://github.com/matter-js/matter.js). Das Matter-Gegenstück
> zu [RedMatic-HomeKit](https://github.com/rdmtc/RedMatic-HomeKit), gemacht
> für [RedMatic](https://github.com/rdmtc/RedMatic) auf der CCU3 / OpenCCU,
> funktioniert aber in jeder Node-RED-Installation.

_[English version](README.en.md)_

> **Version 1.0.0** (September 2026) ist die erste Version für RedMatic 9,
> geprüft mit Apple Home und einem matter.js-Controller auf einer OpenCCU.
> Was sich ändert, steht im [Changelog](CHANGELOG.md).

## Was es kann

- **Homematic-Geräte in Matter** – über einen
  [node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu)-
  ccu-connection Node werden Schalter, Dimmer, Farblichter, Rollläden und
  Jalousien, Thermostate, Tür-/Fensterkontakte, Griffkontakte, Bewegungs-
  und Präsenzmelder, Rauch-, Wasser- und Regenmelder,
  Temperatur-/Feuchte-/Helligkeitssensoren, CO₂-Sensoren, Taster und
  Fernbedienungen, Türschlösser (HmIP-DLD, KeyMatic) und Batteriestände als
  Matter-Endpunkte angelegt. Geräte werden im Editor ausgewählt (opt-in);
  pro Kanal lässt sich einstellen, ob und als was (Steckdose oder Lampe,
  Rollladen mit oder ohne Lamellen) er erscheint.
- **Universal-Node** für beliebige Matter-Geräte aus Node-RED-Nachrichten –
  Lampen, Sensoren, Thermostate, Rollläden, Türschlösser, Taster – für
  Systemvariablen, MQTT, Zigbee2MQTT, Hue und alles andere, was in Node-RED
  ankommt.
- **Switch**, **Pseudobutton** (Steckdose, die sich selbst zurücksetzt und
  eine Nachricht auslöst) und **Event** (Generic-Switch-Taster mit kurz,
  lang und doppelt aus Nachrichten).
- **Bridge-Node** mit QR-Code, Kopplungscode, Liste der gekoppelten
  Controller (einzeln entfernbar), Kopplungsfenster für einen zweiten
  Controller und Werksreset.

Garagentore, Bewässerung und der TV-Node bleiben bei RedMatic-HomeKit: Matter
hat dafür keine Gerätetypen, die Apple Home, Alexa oder Google Home
darstellen. Beide Pakete laufen nebeneinander im selben Node-RED.

## Installation

**RedMatic 9 (CCU3 / OpenCCU):** Im Node-RED-Editor unter _Palette
verwalten → Installieren_ nach `redmatic-matter` suchen und installieren. Es
werden keine nativen Module und keine Binärprogramme benötigt. matter.js
bringt rund 140 MB in 27 000 Dateien mit – die Installation dauert auf einer
CCU3 entsprechend.

**Andere Node-RED-Installationen:** `npm install redmatic-matter` im
Node-RED-Benutzerverzeichnis (`~/.node-red`). Voraussetzungen: Node.js
≥ 22.13, Node-RED ≥ 4.

### Voraussetzungen im Netz

- **IPv6** im LAN (Link-local genügt). Matter-Controller sprechen die
  Bridge über IPv6 an; fehlt dem Host eine IPv6-Adresse, meldet der
  Node-Status einen Fehler. RedMatic 9 sorgt auf der CCU3 für die
  Link-local-Adresse.
- **UDP 5540** (Standardport der Bridge) und **UDP 5353** (mDNS, wird mit
  RedMatic-HomeKit geteilt).
- Ein Matter-Controller im selben Netzsegment: HomePod / Apple TV (Apple
  Home), Echo (Alexa), Nest Hub (Google Home) oder Home Assistant. Zum
  Koppeln reicht die App auf dem Telefon; ein Hub braucht es für
  Automationen und Fernzugriff.

### Einrichtung in Kürze

1. Einen **matter bridge**-Konfigurationsknoten anlegen (Bridge-ID, Passcode
   und Discriminator werden vorgeschlagen; Port 5540 lassen, wenn Alexa
   die Bridge finden soll).
2. Den **homematic**-Node mit der CCU-Verbindung und der Bridge verbinden,
   im Node die gewünschten Geräte anhaken, deployen. Der Node-Status zeigt
   den Kopplungscode, sobald die Bridge online ist.
3. In der Home-App _Gerät hinzufügen_ → QR-Code aus dem Bridge-Dialog
   scannen (oder den Kopplungscode eingeben). Für einen zweiten Controller
   im Bridge-Dialog _Kopplungsfenster öffnen_.

Apple Home verkraftet etwa 150 Endpunkte je Bridge, Alexa 50 und nur eine
Bridge je Host (Port 5540). Für mehr Geräte legt man einen zweiten
Bridge-Knoten (eigene ID, eigener Port) an.

## Geräteunterstützung

Für jeden Kanal ermittelt der Node aus der Gerätebeschreibung der CCU (den
`CONTROL`-Hinweisen, dem Kanaltyp und den Datenpunktnamen) die Rolle und
daraus den Matter-Gerätetyp – dieselbe Rollenerkennung wie in
RedMatic-HomeKit 4. Damit funktionieren auch Geräte, die es beim Erscheinen
dieser Version noch nicht gab, sowie Homebrew- und CUxD-Geräte, deren
Kanäle einer bekannten Rolle entsprechen. Geräte ohne Matter-Entsprechung
stehen grau in der Liste mit ihren Kanaltypen – bitte als Issue melden,
am besten mit einem Auszug der Gerätebeschreibung
(`getParamsetDescription`).

Was welcher Controller davon darstellt (Apple Home zeigt zum Beispiel keine
Druck- und Durchflusssensoren und keine Ventile), steht nach der
Hardware-Prüfung in `device-support.md`.

## Universal-Node: Nachrichtenformat

`msg.topic = <Index>/<Cluster>/<Attribut>` mit den Namen von matter.js,
`msg.payload` der Wert in Matter-Einheiten: `0/onOff/onOff` (boolean),
`0/levelControl/currentLevel` (1–254), `1/temperatureMeasurement/measuredValue`
(Hundertstel Grad), `2/windowCovering/currentPositionLiftPercent100ths`
(0 = offen, 10000 = geschlossen). Änderungen und Kommandos eines
Controllers kommen mit demselben Topic-Schema am Ausgang an
(`0/doorLock/lockDoor`, `0/windowCovering/stopMotion`). Die Hilfe im
Editor enthält Rezepte.

## Entwicklung

```
npm ci
npm test               # lint + unit tests (echte matter.js-Knoten auf Scratch-Ports) + native scan
npm run format
tools/smoke-local.sh   # packt, installiert flach in ein frisches Node-RED 5 und bringt eine Bridge online
```

Hinweise für Beiträge und Agenten stehen in [AGENTS.md](AGENTS.md), der
Plan mit allen Entscheidungen in [ROADMAP.md](ROADMAP.md).

## Danksagung

Dieses Projekt steht auf [matter.js](https://github.com/matter-js/matter.js)
von Ingo Fischer ([Apollon77](https://github.com/Apollon77)) und den
Mitwirkenden des Projekts – der vollständigen Matter-Implementierung in
JavaScript, ohne die es eine Matter-Bridge auf der CCU per Palettenmanager
nicht gäbe. Die Gerätefixtures für die Tests stammen aus dem
[pydevccu](https://github.com/danielperna84/pydevccu)-Katalog von Daniel
Perna, die Rollenerkennung und die Editor-Konzepte aus RedMatic-HomeKit.

## Marken- und Zertifizierungshinweis

> [!IMPORTANT]
> Dieses Projekt implementiert das Matter-Protokoll. Matter™ ist eine Marke
> der Connectivity Standards Alliance. Das Projekt ist **nicht** von der
> Connectivity Standards Alliance zertifiziert, unterstützt oder mit ihr
> verbunden.

## Lizenz

© 2026 Sebastian Raff, Apache License 2.0.
