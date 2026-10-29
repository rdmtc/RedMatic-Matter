# Changelog

Notable changes to redmatic-matter. Format follows
[Keep a Changelog](https://keepachangelog.com/); entries describe the
user-visible change and the reason, not the commit list (the release notes
append commits automatically).

## Unreleased

**Release-Notes (Deutsch).** Homematic-Geräte melden jetzt eQ-3 als
Hersteller; die Home-App zeigte bisher „Unbekannt“. Geräte der übrigen Nodes
(Schalter, Taster, Universal) melden RedMatic. Ob ein bereits gekoppelter
Controller den Hersteller nachträglich übernimmt, hängt vom Controller ab.

**Release notes (English summary).** Homematic devices now report eQ-3 as
their vendor; Apple Home showed "Unknown" before. Devices of the other nodes
(switch, button, universal) report RedMatic. Whether a controller that paired
the bridge earlier takes the vendor over depends on the controller.

### Fixed

- Bridged devices carry a `VendorName` in BridgedDeviceBasicInformation:
  `eQ-3` for the **homematic** node's devices, `RedMatic` for the others.

## 1.0.1 — 2026-10-29

**Release-Notes (Deutsch).** Ist bei einem Gerät nur ein Kanal für Matter
ausgewählt, erscheint er jetzt mit dem Namen des Kanals statt mit dem des
Geräts – ein Schaltaktor, von dem nur ein Kanal verwendet wird, meldet sich
also als „Gartenlicht“ und nicht mehr als „Aktor Werkstatt“. Hat der Kanal
keinen eigenen Namen (leer, seine Adresse oder einer der Vorgabenamen der
CCU wie „Aktor Werkstatt:3“), bleibt es beim Gerätenamen. Die Identität der
Geräte ändert sich nicht: Kopplungen, Räume und Automationen bleiben
erhalten. Die Bridge meldet den neuen Namen nach dem Update an die
gekoppelten Controller; ob ein Controller ihn übernimmt oder bei dem Namen
bleibt, den er beim Hinzufügen gespeichert hat, hängt vom Controller ab –
wer dort noch den alten Namen sieht, benennt das Gerät einmal von Hand um.

**Release notes (English summary).** A device with only one channel
selected for Matter is now announced with that channel's name instead of
the device's - a switch actuator with one channel in use shows up as the
light it switches. Without a name of its own (empty, its address or one of
the CCU's default names such as "Switch actuator 1:3") the channel keeps
the device's name. The endpoints' identity is unchanged, so pairings, rooms
and automations stay. The bridge reports the new name to paired controllers
after the update; whether a controller takes it over or keeps the name it
stored when the device was added depends on the controller - where the old
name stays, rename the device there once.

### Fixed

- **homematic** node: a device with a single enabled endpoint is labelled
  with its channel's name (BridgedDeviceBasicInformation `NodeLabel`); the
  device name only when the channel carries none of its own.

### Changed

- Release workflow: after the npm publish the Node-RED flow library is
  asked to pick up the new version, and it waits while the library's npm
  cache still shows the previous one.

## 1.0.0 — 2026-09-04

**Release-Notes (Deutsch).** RedMatic-Matter ist das Matter-Gegenstück zu
RedMatic-HomeKit: Homematic-Geräte einer CCU und beliebige Node-RED-Daten
erscheinen als Matter-Bridge in Apple Home, Alexa, Google Home oder Home
Assistant – ohne Cloud, ohne zusätzliche Hardware, installiert über den
Palettenmanager von RedMatic 9 (Suche nach `redmatic-matter`). Beide Pakete
laufen nebeneinander im selben Node-RED; Garagentor, Bewässerung und TV
bleiben bei RedMatic-HomeKit, weil Matter dafür keine Gerätetypen hat, die
die großen Controller darstellen. Geprüft wurde mit Apple Home und dem
matter.js-Controller des Autors auf einer OpenCCU: Koppeln per QR-Code und
über das Kopplungsfenster für einen zweiten Controller, Schalten und Dimmen
in beide Richtungen, Tasterdrücke, Batteriestand, Neustart mit erhaltenen
Kopplungen, Hinzufügen und Entfernen von Geräten ohne Neustart. Matter
braucht IPv6 im LAN und einen Controller im selben Netzsegment; RedMatic
sorgt auf der CCU3 für die nötige Link-local-Adresse. Wer ein Gerät
vermisst oder falsch abgebildet sieht: Issue mit Gerätetyp öffnen, die
generische Zuordnung lässt sich meist ohne Code erweitern.

**Release notes (English summary).** RedMatic-Matter is the Matter sibling
of RedMatic-HomeKit: Homematic devices of a CCU and arbitrary Node-RED
data appear as a Matter bridge in Apple Home, Alexa, Google Home or Home
Assistant, installed through the palette manager of RedMatic 9, running
side by side with RedMatic-HomeKit in one Node-RED. Verified with Apple
Home and the author's matter.js controller on an OpenCCU: pairing by QR
code and through the commissioning window for a second controller,
switching and dimming both ways, key presses, battery level, restart with
pairings kept, adding and removing devices without a restart. Matter needs
IPv6 on the LAN and a controller on the same segment.

Built on [matter.js](https://github.com/matter-js/matter.js) by Ingo
Fischer (Apollon77) and contributors.

### Added

- **Bridge config node** (`redmatic-matter-bridge`): one matter.js
  ServerNode with an aggregator per node, storage under
  `<userDir>/matter/<bridge id>`, QR code and manual pairing code in the
  dialog, list of paired controllers (fabrics) with per-controller removal,
  "open commissioning window" and "factory reset" buttons, IPv6 and port
  pre-flight with a plain-language error. The Matter node survives deploys;
  it starts only after every feeding node has added its endpoints.
- **switch**, **pseudobutton**, **programmable switch** (one Generic Switch
  endpoint per button with single, double and long press) and **universal**
  node (a list of Matter device types per node, `msg.topic =
<index>/<cluster>/<attribute>`, output for controller writes and
  commands).
- **homematic** node: opt-in device list with per-channel choices, Matter
  endpoints for switches, dimmers, colour lights, blinds/shutters/jalousies,
  contacts and rotary handles, motion and presence sensors (with
  illuminance), smoke, water and rain detectors, temperature/humidity/light
  sensors, CO₂ sensors, thermostats (heating; 4.5 °C = off; boost as an
  opt-in plug), door locks (HmIP-DLD/DLS, KeyMatic), keys and remotes
  (Generic Switch), battery (PowerSource, on every endpoint of the device) and reachability from the
  maintenance channel. HmIP actuators read their state from the transmitter
  channel and write to the virtual receiver; HmIP keys are declared "in
  use" so the CCU forwards their presses; HmIP multi-mode inputs follow
  their operating mode.
- Endpoint identity: `<address or node id>~<device type key>`, so the
  same channel with the same type always gets the same endpoint number and
  a changed shape gets a new identity instead of confusing the controller.
- A bare "on" sent to a dimmer is deferred 500 ms and superseded by a level
  write in that window (voice assistants send both), off and explicit
  values are immediate; only controller-originated changes are written to
  the CCU (actor context), never our own updates.
- Tests against real matter.js ServerNodes (every device type initialises,
  persistence of endpoint numbers, identity rotation, two bridges per
  process, factory reset, commands, presses), 385 device fixtures with role
  and mapping snapshots, node tests with a fake Node-RED, CI with the
  native-dependency scan.
