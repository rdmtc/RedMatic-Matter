# Changelog

Notable changes to redmatic-matter. Format follows
[Keep a Changelog](https://keepachangelog.com/); entries describe the
user-visible change and the reason, not the commit list (the release notes
append commits automatically).

## Unreleased (1.0.0)

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
