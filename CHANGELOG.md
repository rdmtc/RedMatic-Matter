# Changelog

Notable changes to redmatic-matter. Format follows
[Keep a Changelog](https://keepachangelog.com/); entries describe the
user-visible change and the reason, not the commit list (the release notes
append commits automatically).

## Unreleased (1.0.0)

First implementation (1.0.0-dev.0, 2026-09-04), not yet verified on
hardware or against a real controller (ROADMAP task 15).

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
  (Generic Switch), battery (PowerSource) and reachability from the
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
