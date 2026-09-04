# RedMatic Matter

[![NPM version](https://badge.fury.io/js/redmatic-matter.svg)](http://badge.fury.io/js/redmatic-matter)
[![CI](https://github.com/rdmtc/RedMatic-Matter/actions/workflows/ci.yml/badge.svg)](https://github.com/rdmtc/RedMatic-Matter/actions/workflows/ci.yml)

> Node-RED nodes that expose Homematic devices and arbitrary Node-RED data
> as a **Matter bridge**, built on
> [matter.js](https://github.com/matter-js/matter.js). The Matter sibling of
> [RedMatic-HomeKit](https://github.com/rdmtc/RedMatic-HomeKit), made for
> [RedMatic](https://github.com/rdmtc/RedMatic) on the CCU3 / OpenCCU, works
> in any Node-RED installation.

_[Deutsche Version](README.md) — the German README is the primary one._

> **Development status (September 2026):** the nodes are implemented and
> tested against real matter.js nodes, but not yet verified on CCU hardware
> or with Apple Home / Alexa. The plan is in [ROADMAP.md](ROADMAP.md),
> changes in the [changelog](CHANGELOG.md).

## Features

- **Homematic devices in Matter** — through a
  [node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu)
  connection: switches, dimmers, colour lights, blinds, shutters and
  jalousies, thermostats, door/window contacts, rotary handles, motion and
  presence sensors, smoke, water and rain detectors,
  temperature/humidity/light sensors, CO₂ sensors, push buttons and
  remotes, door locks (HmIP-DLD, KeyMatic) and battery levels become Matter
  endpoints. Devices are selected in the editor (opt-in); per channel you
  choose whether and as what (plug-in unit or light, blind with or without
  tilt) it appears.
- **Universal node** for any Matter device driven by Node-RED messages —
  lights, sensors, thermostats, window coverings, door locks, buttons — for
  system variables, MQTT, zigbee2mqtt, Hue, anything that arrives in
  Node-RED.
- **Switch**, **pseudobutton** (auto-resetting plug that emits a message)
  and **event** (Generic Switch buttons with single, double and long press
  from messages).
- **Bridge node** with QR code, manual pairing code, list of paired
  controllers (removable one by one), a commissioning window for a second
  controller and a factory reset.

Garage doors, irrigation and the TV node stay on RedMatic-HomeKit: Matter
has no device types for them that Apple Home, Alexa or Google Home render.
Both packages run side by side in one Node-RED.

## Installation

**RedMatic 9 (CCU3 / OpenCCU):** in the Node-RED editor open _Manage
palette → Install_, search for `redmatic-matter` and install. No native
modules, no binaries. matter.js weighs about 140 MB in 27,000 files — the
install takes a while on a CCU3.

**Other Node-RED installations:** `npm install redmatic-matter` in the
Node-RED user directory (`~/.node-red`). Requirements: Node.js ≥ 22.13,
Node-RED ≥ 4.

### Network requirements

- **IPv6** on the LAN (link-local is enough). Matter controllers reach the
  bridge over IPv6; without an IPv6 address on the host the node status
  shows an error. RedMatic 9 creates the link-local address on the CCU3.
- **UDP 5540** (default bridge port) and **UDP 5353** (mDNS, shared with
  RedMatic-HomeKit).
- A Matter controller on the same network segment: HomePod / Apple TV
  (Apple Home), Echo (Alexa), Nest Hub (Google Home) or Home Assistant. The
  phone app is enough for pairing; a hub is needed for automations and
  remote access.

### Quick start

1. Create a **matter bridge** config node (bridge id, passcode and
   discriminator are suggested; keep port 5540 if Alexa should find the
   bridge).
2. Wire the **homematic** node to the CCU connection and the bridge, tick
   the devices you want, deploy. The node status shows the pairing code
   once the bridge is online.
3. In the Home app choose _Add accessory_ and scan the QR code from the
   bridge dialog (or enter the pairing code). For a second controller use
   _Open commissioning window_ in the bridge dialog.

Apple Home copes with about 150 endpoints per bridge, Alexa with 50 and only
one bridge per host (port 5540). For more devices add a second bridge node
(own id, own port).

## Device support

For every channel the node derives the role from the CCU's device
description (the `CONTROL` hints, the channel type and the datapoint names)
and from it the Matter device type — the same role detection as
RedMatic-HomeKit 4. This also covers devices that did not exist when this
version was released, as well as homebrew and CUxD devices whose channels
match a known role. Devices without a Matter equivalent are listed greyed
out with their channel types — please open an issue, ideally with an
excerpt of the device description (`getParamsetDescription`).

What each controller renders (Apple Home for example shows no pressure and
flow sensors and no valves) will be recorded in `device-support.md` after
the hardware verification.

## Universal node: message format

`msg.topic = <index>/<cluster>/<attribute>` with matter.js' names,
`msg.payload` the value in Matter units: `0/onOff/onOff` (boolean),
`0/levelControl/currentLevel` (1–254), `1/temperatureMeasurement/measuredValue`
(hundredths of a degree), `2/windowCovering/currentPositionLiftPercent100ths`
(0 = open, 10000 = closed). Controller writes and commands arrive on the
output with the same topic scheme (`0/doorLock/lockDoor`,
`0/windowCovering/stopMotion`). The editor help carries recipes.

## Development

```
npm ci
npm test               # lint + unit tests (real matter.js nodes on scratch ports) + native scan
npm run format
tools/smoke-local.sh   # packs, installs shallowly into a fresh Node-RED 5, brings a bridge online
```

Notes for contributors and agents are in [AGENTS.md](AGENTS.md), the plan
with every decision in [ROADMAP.md](ROADMAP.md).

## Credits

This project stands on [matter.js](https://github.com/matter-js/matter.js)
by Ingo Fischer ([Apollon77](https://github.com/Apollon77)) and the
project's contributors — the complete Matter implementation in JavaScript
without which a Matter bridge on the CCU through the palette manager would
not exist. The device fixtures for the tests come from Daniel Perna's
[pydevccu](https://github.com/danielperna84/pydevccu) catalogue, the role
detection and the editor concepts from RedMatic-HomeKit.

## Trademark and certification notice

> [!IMPORTANT]
> This project implements the Matter protocol. Matter™ is a trademark of the
> Connectivity Standards Alliance. This project is **not** certified by,
> endorsed by, supported by, or affiliated with the Connectivity Standards
> Alliance.

## License

© 2026 Sebastian Raff, licensed under the Apache License 2.0.
