# RedMatic-Matter Roadmap

Planned direction for **redmatic-matter**: Node-RED nodes that expose
Homematic devices (through node-red-contrib-ccu) and arbitrary Node-RED data
as a **Matter bridge**, built on [matter.js](https://github.com/matter-js/matter.js).
The package is the Matter sibling of
[RedMatic-HomeKit](https://github.com/rdmtc/RedMatic-HomeKit): the same node
set, the same editor UX and the same concepts (bridge config node, automatic
Homematic mapping with per-channel choices, universal node driven by
messages), with matter.js in the place of HAP-NodeJS. Primary audience:
RedMatic 9 on a CCU3 / OpenCCU, installed through the Node-RED palette
manager. It must work in any Node-RED installation as well.

Convention (same scheme as RedMatic, node-red-contrib-ccu and
RedMatic-HomeKit): task numbers are stable and never reused. This file holds
the open items; when a task is completed its content moves to
`roadmap-archive/task-N.md` and its line in the contents gets a ✅ marker.
Decisions are recorded as **D-n**, open questions as **OQ-n**; both keep
their ids forever. References to decisions of the sibling projects keep their
prefixes (`hm2matter M-n`, `RedMatic-HomeKit D-n`, `hm2mqtt H-n`).

Status 2026-09-04: **tasks 6–11 implemented (1.0.0-dev.0), nothing verified
on hardware or against a controller yet.** `npm test` is green (lint, 45
unit tests against real matter.js ServerNodes, native scan). The
implementation was written on a machine without `../hm2matter` (it only
existed on the Mac), so the Matter core was built from this roadmap's
specification against matter.js 0.17.9 directly rather than ported — the
findings are in appendix A ("Verified 2026-09-04"). Siblings at that point:
`../RedMatic-HomeKit` 4.0.0 (released 2026-09-04; the UX and structure
template, its `roles.js`, fixtures and test helpers are copied here),
`../node-red-contrib-ccu` 4.1.0-dev.5 (the data source),
`../RedMatic` 9.0.0 (released 2026-09-04: Node 24 / Node-RED 5.0.6, **without
the IPv6 link-local fix of task 13**). Next: task 15 (hardware gate) and the
task 13 item in RedMatic.

Status 2026-09-02: research and planning only. Research basis: `../hm2matter`
(the abandoned standalone CCU addon), `../RedMatic-HomeKit` 4.0.0-dev.7,
`../node-red-contrib-ccu` 4.1.0-dev.5, `../RedMatic` 9.0.0-dev.12, matter.js
0.17.9, and the web research summarised in appendix A.

## Contents

**Ground truth**

- [1. Where we stand](#1-where-we-stand)
- [2. What is ported from where](#2-what-is-ported-from-where)
- [3. Node set and UX](#3-node-set-and-ux)
- [4. Decisions](#4-decisions)
- [5. Open questions](#5-open-questions)

**Tasks**

- [6. Project skeleton and tooling](#6-project-skeleton-and-tooling)
- [7. Matter core in CommonJS](#7-matter-core-in-commonjs)
- [8. Bridge config node](#8-bridge-config-node)
- [9. Generic nodes: switch, pseudobutton, programmable switch, universal](#9-generic-nodes-switch-pseudobutton-programmable-switch-universal)
- [10. Homematic devices node](#10-homematic-devices-node)
- [11. Tests, fixtures and CI](#11-tests-fixtures-and-ci)
- [12. Garage and irrigation — deliberately absent](#12-garage-and-irrigation--deliberately-absent)
- [13. Platform work outside this repo](#13-platform-work-outside-this-repo)
- [14. Documentation](#14-documentation)
- [15. Hardware verification and release 1.0.0](#15-hardware-verification-and-release-100)
- [16. After 1.0.0](#16-after-100)

**Appendix**

- [A. Research notes (2026-09-02)](#a-research-notes-2026-09-02)
- [B. HomeKit service → Matter device type](#b-homekit-service--matter-device-type)

## 1. Where we stand

**hm2matter** (`../hm2matter`, no GitHub remote, MIT) was the first attempt:
a standalone CCU addon with its own XML-RPC/BIN-RPC stack copied from
hm2mqtt.js, a yargs config and a Svelte UI. Decided 2026-09-02: **abandoned
in favour of this project.** What it leaves behind is exactly what this
project needs and is ported (section 2):

- `lib/matter.js` — ServerNode + AggregatorEndpoint lifecycle, add/remove
  endpoints at runtime, pairing codes, commissioning window, factory reset.
- `lib/matter-devices.js` — the matter.js device-type/cluster imports with
  the feature choices that make endpoints initialise at all (M-17: six of
  fifteen types fail without them), composite endpoints with several device
  types, PowerSource for battery devices.
- `lib/mapping/` — eleven pure mappers over 23 channel types, the
  `events`/`writes`/`combined`/`commands`/`presses` contract (M-16), tested
  against 2222 real paramset descriptions and round-tripped through a real
  ServerNode (104 tests).
- `lib/bridge.js` — the bridge loop: echo suppression via matter.js'
  `context.offline`, 20 ms write coalescing, movement hold for ramps,
  UNREACH → `reachable`, LOWBAT → PowerSource (M-19).
- Research on the CCU as a Matter host (M-13, M-14, OQ-1, OQ-2): the CCU3
  has **no IPv6 link-local address after boot** (kernel bring-up order of
  the USB NIC), one sysctl write creates it; UDP 5353 is shared with every
  responder that sets `SO_REUSEADDR`; UDP 5540 is free.

**matterbridge-homematic 1.0.4** (`hobbyquaker/matterbridge-homematic`, the
same author's matterbridge plugin, TypeScript) is **not** a code source and
matterbridge is **not** a dependency in any form (D-1). It is consulted for
what it learned about mappings and controllers, and those lessons are
recorded here so nobody has to open it again: the channel-type table
(already corrected and ported in hm2matter §1.3), `device-support.md` as
the format for our support table (task 14), FIX-0 (dimmer flash: command
handlers instead of attribute subscriptions, a deferred bare "on", voice
assistants send on + level up to ~400 ms apart — task 7), HM-9 (garage
door: Matter 1.5 _Closure_ is the right device type but no controller
renders it as of mid-2026, `windowCovering`/`doorLock` are the fallbacks —
task 12), UX-2 (new channels must start disabled — D-7), RN-0 (ReGa
renames must reach the controller — task 10), `device-power.ts` (battery
percentage from `OPERATING_VOLTAGE` with per-model voltage ranges — task
10), HM-8 (programs/variables with ReGa ids as identity — task 16).

**RedMatic-HomeKit 4.0.0-dev.7** is the template for everything user-facing
and for the project shape: nine nodes, bridge config node with QR code in
the editor, the homematic device list driven by a runtime catalogue endpoint,
generic channel mapping (`lib/roles.js`, `lib/generic.js`) over 383 device
fixtures with snapshot tests, `test/helpers/{fake-red,fake-ccu,fixtures}.js`,
ESLint 9 + Prettier, `node --test`, `ci.yml` (Node 22/24 × Node-RED 4/5,
native-module scan), `release.yml` with npm OIDC provenance, German-first
docs. Its consumer contract with node-red-contrib-ccu — `register`,
`deregister`, `subscribe`, `unsubscribe`, `setValueQueued`, `findIface`,
`getParamsetDescription`, `channelNames`, `metadata.devices`,
`enabledIfaces`, `values`, `setStatus({ifaceStatus})` — is unchanged in
4.1.0-dev and is what this package uses too.

**RedMatic 9** ships Node 24.20 / Node-RED 5.0.6, bundles only
node-red-contrib-ccu, has no package manager and no compiler: this package
is installed through the palette manager (`install-strategy=shallow`, no
lockfile) and must contain **no native code anywhere in its tree**.

**Verified locally 2026-09-02** (Node 24.20, matter.js 0.17.9 from
hm2matter's `node_modules`):

- `require('@matter/main')` works from CommonJS (the package ships
  `dist/cjs` next to `dist/esm`, `exports` has `require` conditions for the
  root and every subpath such as `@matter/main/devices/on-off-light`);
  540 exports, cold load ≈ 3.6 s on a Mac.
- Dependency tree: `@matter/{main,general,model,node,nodejs,protocol,types}`
  plus `@noble/curves`; **zero native modules**, no install scripts.
  `@matter/nodejs` is an `optionalDependency` of `@matter/main`.
- Footprint: **137 MB, 26 600 files** for `@matter/*` — half of it is
  `*.map` (49 MB) and `*.d.ts` (35 MB), plus `src/` (22 MB) and the unused
  build flavour (CJS or ESM, ≈ 55 MB). A palette install cannot strip any
  of it (OQ-6).
- mDNS reuse: `@homebridge/ciao` (HomeKit 4.0's default responder) binds
  its sockets with `reuseAddr: true` at both call sites, `multicast-dns`
  (bonjour-hap) defaults to `reuseAddr: true`, matter.js'
  `NodeJsUdpSocket` sets `reuseAddr` from `reuseAddress: true`. All three
  responders can share port 5353 in one process (D-5).
- matter.js' `MdnsService` reads `mdns.ipv4` (default on) and
  `mdns.networkInterface` from the environment: IPv4 and single-interface
  operation are configurable.

## 2. What is ported from where

Status 2026-09-04: `../hm2matter` was not available on the implementation
machine. The pieces attributed to it below were **written new** from this
roadmap's specification and the matter.js 0.17.9 API (same behaviour, no
code lineage); the RedMatic-HomeKit pieces were copied as planned.

| Piece                                   | Source                                            | Change on the way                                                                                    |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ServerNode/aggregator lifecycle         | hm2matter `lib/matter.js`                         | ESM → CJS; one shared `Environment`, one storage root; several bridges per process (task 7)          |
| Device types, features, composition     | hm2matter `lib/matter-devices.js`                 | ESM → CJS; extended by the types the universal node and the wider mapping need                       |
| Channel mappers                         | hm2matter `lib/mapping/*`                         | ESM → CJS; role detection widened with RedMatic-HomeKit's `roles.js` (locks, valves, rain, CO₂, …)   |
| Bridge loop                             | hm2matter `lib/bridge.js`                         | ESM → CJS; CCU access via node-red-contrib-ccu (`subscribe`/`setValueQueued`) instead of its own RPC |
| CCU plumbing (rpc, interfaces, rega)    | hm2matter (from hm2mqtt.js)                       | **dropped** — node-red-contrib-ccu owns the connection                                               |
| Config, CLI, Svelte UI, addon packaging | hm2matter                                         | **dropped** — Node-RED editor and palette install replace them                                       |
| Node set, editor dialogs, help texts    | RedMatic-HomeKit `nodes/*`                        | HAP calls → matter.js; service list → device-type list; QR from `qrPairingCode`                      |
| Catalogue endpoint + device list UX     | RedMatic-HomeKit `lib/catalogue.js`, devices html | options per role instead of per module (there are no per-model modules here, D-6)                    |
| Role detection                          | RedMatic-HomeKit `lib/roles.js`                   | copied (OQ-9 decides when it becomes a shared package)                                               |
| Fixtures, snapshots, test harness       | RedMatic-HomeKit `test/`                          | fake ccu + fake RED reused; real ServerNode instead of real HAP                                      |
| Tooling, CI, release, docs conventions  | RedMatic-HomeKit                                  | `check-native.js` learns an allowlist for `@matter/nodejs` (optionalDependency)                      |

## 3. Node set and UX

Same palette category shape as HomeKit ("redmatic matter"), same colours and
icon placement, one `.js` + `.html` pair per node, German inline help.

| RedMatic-HomeKit node                          | RedMatic-Matter node                 | Matter side                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redmatic-homekit-bridge` (config)             | `redmatic-matter-bridge` (config)    | one `ServerNode` + `AggregatorEndpoint`; QR + manual pairing code in the dialog; list of paired fabrics with per-fabric remove; open commissioning window; factory reset |
| `redmatic-homekit-homematic-devices`           | `redmatic-matter-homematic-devices`  | one bridged endpoint per selected channel, per-channel "as what" dropdown, options per device                                                                            |
| `redmatic-homekit-universal`                   | `redmatic-matter-universal`          | list of device types (instead of HAP services), `msg.topic = <index>/<cluster>/<attribute>`                                                                              |
| `redmatic-homekit-switch`                      | `redmatic-matter-switch`             | `OnOffPlugInUnit` (default) or `OnOffLight`, on/off in and out                                                                                                           |
| `redmatic-homekit-pseudobutton`                | `redmatic-matter-pseudobutton`       | `OnOffPlugInUnit` that snaps back to off and emits the configured payload                                                                                                |
| `redmatic-homekit-statelessprogrammableswitch` | `redmatic-matter-programmableswitch` | N `GenericSwitch` endpoints (momentary, long press, multi-press)                                                                                                         |
| `redmatic-homekit-homematic-garage`            | —                                    | not ported (D-16): stays on RedMatic-HomeKit, which runs alongside                                                                                                       |
| `redmatic-homekit-homematic-irrigation`        | —                                    | not ported (D-16)                                                                                                                                                        |
| `redmatic-homekit-tv`                          | —                                    | not ported (D-10)                                                                                                                                                        |

Concepts kept from HomeKit, translated:

- **Bridge identity must not change after pairing.** HomeKit: bridge MAC
  and `<userDir>/homekit`. Matter: a bridge **id** the dialog suggests
  (random, editable before the first pairing, never afterwards) that names
  the storage directory `<userDir>/matter/<id>` holding the fabrics
  (pairings) and the persisted endpoint numbers; vendor/product id fixed
  (D-4).
- **Accessory identity = CCU address.** HomeKit: `uuid(address)`. Matter:
  endpoint `id` = sanitised channel address, `serialNumber` = channel
  address, `uniqueId` derived; matter.js persists the endpoint _number_
  per `id`, which is what the controller keys rooms and automations on.
- **Per-channel choice** in the device list: switch channels as plug-in
  unit / light / (fan later), contacts as contact sensor, blinds with or
  without tilt, motion as occupancy with optional light sensor, battery
  optional. Same `devices` config format (`<address>: {disabled, type, …}`)
  so a HomeKit configuration can be copied over by hand where the values
  match.
- **Universal node message contract**, HomeKit `<subtype>/<Characteristic>`
  becomes `<endpoint index>/<cluster>/<attribute>` with matter.js' names
  (`0/onOff/onOff`, `0/levelControl/currentLevel`,
  `1/temperatureMeasurement/measuredValue`); output carries controller
  writes and commands (`0/doorLock/lockDoor`, `0/windowCovering/stopMotion`).
  An object payload patches several attributes of one cluster at once.

## 4. Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1  | **matter.js directly** (`@matter/main`) and **nothing from matterbridge** — not as a dependency, not as a vendored helper, not as a runtime; matterbridge-homematic is read for mapping knowledge only (section 1). matter.js is **required from CommonJS** through its `dist/cjs` build. The sibling packages are CommonJS (ccu D-2, HomeKit), Node-RED loads nodes with `require`, and the CJS build is a first-class export of every `@matter/*` package (verified, section 1). No build step, no TypeScript, JSDoc where types help (hm2matter M-15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D-2  | **Zero native modules, zero binaries, zero install scripts** in the whole tree (RedMatic-HomeKit D-1). matter.js qualifies today; `tools/check-native.js` from HomeKit guards it in CI, with `@matter/nodejs` allow-listed as the one legitimate `optionalDependency`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-3  | **Node ≥ 22.13, Node-RED 4 and 5** (`engines` `^22.13 \|\| >=24`, `node-red.version >=4.0.0`). Node 20 is excluded by matter.js' engine range and by the CJS `require(esm)`-free route not mattering here. RedMatic 9 ships Node 24 / Node-RED 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D-4  | **Identity is pinned before the first release** (hm2matter M-5, HomeKit D-4): one storage root `<userDir>/matter` (`storage.path`, process-wide), ServerNode `id` = bridge id so matter.js keeps each bridge in `<userDir>/matter/<bridge id>` (its designed multi-node layout, appendix A), endpoint `id`/`serialNumber` from the CCU address (universal/switch/… nodes: the Node-RED node id), `uniqueId` = hash of it, vendor id `0xFFF1` / product id fixed. A bridge that keeps its id keeps its fabrics across deploys, restarts, updates and CCU backups (RedMatic's backup hook covers `<userDir>`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-5  | **Runs next to RedMatic-HomeKit in the same Node-RED process on one CCU.** Requirement stated 2026-09-02. Ports differ by protocol (HomeKit TCP 51826+, Matter UDP 5540+); UDP 5353 is shared because ciao, bonjour-hap and matter.js all bind with `SO_REUSEADDR` (verified in the three code bases); storage directories differ (`homekit/` vs `matter/`); both use the same ccu-connection node, so no extra RPC callback ports. Homebridge ≥ 2.2 ships exactly this pairing (matter.js + ciao in one process) in production, which is the strongest evidence it works (appendix A). The bridge node pre-flights 5353 and its own port with a reuse bind before starting (hm2matter M-14) and reports a taken port in one plain line, and offers an "IPv6-only mDNS" switch as Homebridge does for hosts where IPv4 multicast reaches only one responder. What the socket layer cannot prove — that records of both responders stay discoverable — is OQ-5 and part of the hardware gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-6  | **Generic mapping only, no per-model modules.** hm2matter M-16 showed that every per-model difference is readable from the VALUES paramset description (slats = `LEVEL_2`, setpoint variants, relay writability). Mappers are pure functions of (channel, description, options), tested against fixtures, with HomeKit's role list as the detection layer (CONTROL hint → channel type → datapoint names). A device the mapping does not know shows up in the list as unsupported, never silently missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-7  | **Selection in the homematic node is opt-in by device** (hm2matter M-9, confirmed by the maintainer 2026-09-02): nothing is bridged until a device is ticked; ticking takes every mappable channel, single channels can be unticked. This differs from HomeKit's "everything on unless disabled" on purpose: a CCU has hundreds of channels, controllers cap bridged endpoints (appendix A: Apple ≈ 150, Alexa 50) and matter.js keeps every endpoint's state in RAM on a 1 GB box. "Enable all" stays as a button; the list shows the selected count against the caps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D-8  | **Deploys must not re-pair.** A ServerNode is kept alive across "modified nodes/flows" deploys in a module-level registry keyed by bridge id (HomeKit keeps its `Bridge` objects the same way; knx-ultimate does it with matter.js 0.17 — appendix A); child nodes re-attach to existing endpoints on redeploy, add new ones and remove only those whose node was deleted (`remove === true` in the close handler). A full restart re-creates the node from storage with the same endpoint numbers (matter.js persists them per endpoint `id`). Endpoint removal uses `endpoint.close()` (state kept) unless the node was deleted, then `delete()`. The "close and recreate on every deploy" approach of sammachin's node is exactly what produced its re-pairing and duplicate-id issues. Two Apple Home rules from the field (appendix A): **every endpoint is added before the ServerNode goes online** — a bridge that comes up empty and adds endpoints a second later races the hub's re-subscription and the hub deletes what it cannot see — and a structural change of an existing endpoint (a channel re-typed from light to plug-in unit) **rotates its identity** (endpoint id suffixed with the type) instead of reusing it, because Apple Home turns a same-id/different-shape device into an uneditable record. `BridgedDeviceBasicInformation.configurationVersion` (Matter 1.4.2, matter.js ≥ 0.17.5) is bumped on every such change. |
| D-9  | **Universal node = device types, not clusters.** The dialog offers matter.js device types (light, dimmable light, colour light, plug-in unit, contact/occupancy/temperature/humidity/light/pressure/flow sensors, thermostat, window covering, door lock, generic switch, fan, smoke/CO alarm, water leak, air quality, …), each becoming one bridged endpoint; clusters and attributes are addressed by the message topic. Composing extra clusters onto a type (a light with a temperature sensor) is a later option, not the first release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-10 | **No TV node, no camera, no zigbee.** Release targets for 1.0.0 are **Apple Home and Alexa** (maintainer 2026-09-02, OQ-8); Home Assistant is the diagnostic controller, Google Home follows after 1.0.0. Matter's video player device types are not rendered by Apple Home and the HomeKit TV node existed for the Control Center remote; there is nothing to port. Cameras (Matter 1.5) and zigbee are out of scope as in HomeKit D-6/D-7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-11 | **matter.js is pinned to a minor** (`~0.17.9` today; 0.17.5+ implements Matter 1.6, 0.18 nightlies carry breaking device-side changes — appendix A) and bumped deliberately with a changelog entry; the library is pre-1.0 and its behavior API still moves. The CI matrix runs the pinned version only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D-12 | **Same tooling and process as the siblings** (HomeKit D-8): ESLint 9 flat config + Prettier (4 spaces, 120 cols, `eslint-plugin-html`), `node --test`, `ci.yml` + tag-driven `release.yml` with npm OIDC provenance (`-dev.N` → `next`, releases → `latest`), Keep-a-Changelog `CHANGELOG.md`, `AGENTS.md` + `CLAUDE.md`, `HANDOFF.md` at session ends, no Dependabot. Versions `1.0.0-dev.N` on master, `1.0.0` after the hardware gate (task 15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-13 | **License Apache-2.0** (like RedMatic-HomeKit and matter.js; hm2matter's MIT code is the same author's and is relicensed by porting; confirmed 2026-09-02 together with the `1.0.0-dev.N` scheme of D-12). Repository `rdmtc/RedMatic-Matter`, npm `redmatic-matter`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-14 | **IPv6 is a stated requirement, not something the node fixes.** The bridge node checks at start that its interface has an IPv6 address and shows a red status with the exact sentence otherwise ("no IPv6 address on eth0 — Matter controllers cannot reach this bridge; update RedMatic"); creating the CCU3's missing link-local address at boot belongs to RedMatic's start script (task 13, confirmed by the maintainer 2026-09-02, OQ-7), because it is a platform defect, not a node's job. hm2matter's sysctl-writing option (M-13) is not carried over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-15 | **hm2matter is archived, not deleted.** Its roadmap holds the hardware findings (IPv6, 5353, RAM) and its tests are the porting checklist; nothing is developed there any more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-16 | **No garage and no irrigation node** (decided by the maintainer 2026-09-02). Matter has no garage door opener that a controller renders (Closure, Matter 1.5, is unsupported by every major controller as of mid-2026) and Apple Home does not render the water valve; a cover- or lock-shaped stand-in would lose exactly what makes the HomeKit garage node valuable — the garage tile, Siri grammar and the CarPlay prompt when driving into the street. Those two nodes stay on RedMatic-HomeKit, which runs next to this package on the same CCU (D-5) — that coexistence is the reason both packages exist. Revisit when Apple renders Closure / valve device types (task 12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-17 | **Endpoint identity = `<owner id>~<device type key>`** (2026-09-04, refines D-4/D-8). The owner id is the CCU channel address or `<node id>/<index>`; the type key is the device type name plus its option flags (`contactSensor+battery`, `windowCovering+tilt`). The same channel with the same type always maps to the same endpoint id and therefore the same persisted endpoint number, and a changed shape rotates the identity deterministically without keeping history. `uniqueId` is a hash of bridge id and endpoint id; `serialNumber` stays the plain address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-18 | **Factory reset = close the node, delete `<storage>/<bridge id>`, start again** (2026-09-04). matter.js 0.17.9's `ServerNode.erase()` resets in place but the node can no longer be closed completely afterwards (operational sockets and the storage lock stay open — found by the node tests hanging). Removing the directory is what "forget everything" means anyway; endpoints are re-created from the `Device` handles' shadow state, so nothing visible is lost apart from the fabrics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-19 | **Command hooks acquire the state lock asynchronously** (2026-09-04): every behaviour override in `commands.js` runs `await transaction.addResources(this); await transaction.begin()` before matter.js' default implementation. A `set()` on an endpoint (a CCU event) holds the state lock for tens of milliseconds while the storage commit runs; matter.js' default command handlers lock synchronously and fail with "Cannot lock … synchronously" in that window, which a blind reporting positions every second while the user taps stop would hit routinely. Same pattern matter.js' own behaviours use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 5. Open questions

| ID    | Question                                                                                                                                                                                                                                                         | Proposal / how it gets answered                                                                                                                                                                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1  | **answered 2026-09-02 by the maintainer: opt-in** (D-7 stands).                                                                                                                                                                                                  | "Enable all" button stays; the device list shows the count of selected endpoints against the controller caps.                                                                                                                                                                                                    |
| OQ-2  | **closed 2026-09-02 by D-16**: no garage node. Matter 1.5 _Closure_ would be the right device type, but no controller renders it (matterbridge-homematic HM-9 research); a cover/lock stand-in was rejected by the maintainer.                                   | Garage doors stay on RedMatic-HomeKit. HmIP-MOD-HO/WGC channels are listed as "no Matter equivalent" in the device list. Task 12 holds the trigger for revisiting.                                                                                                                                               |
| OQ-3  | **closed 2026-09-02 by D-16**: no irrigation node. Apple Home does not render `WaterValve` (appendix A).                                                                                                                                                         | Irrigation stays on RedMatic-HomeKit; a Homematic valve/switch channel still appears as a plug-in unit through the homematic node. Task 12 holds the trigger for revisiting.                                                                                                                                     |
| OQ-4  | How many bridged endpoints fit on a CCU3 (970 MB RAM, four slow cores)? matter.js alone costs ≈ 166 MB RSS after `require` on Node 24 (appendix A), before RedMatic's own Node-RED and HomeKit load; controllers cap at ≈ 150 (Apple) and 50 (Alexa) per bridge. | Measure 10 / 50 / 150 endpoints on the OpenCCU box and the CCU3 (task 15); the device list warns past the measured number; document a "second bridge node" recipe as HomeKit does for 149 — with the Alexa caveat that only one bridge per host (port 5540) is discoverable there.                               |
| OQ-5  | mDNS coexistence in one process: with ciao (HomeKit) and matter.js both answering on 5353, are `_matter._tcp`/`_matterc._udp` **and** `_hap._tcp` still found, including by legacy unicast queries that reach only one socket? (hm2matter OQ-2)                  | Install both packages on the OpenCCU box, pair both, restart each in turn, browse from a LAN host. Fallbacks: bind matter.js' mDNS to one interface, or (upstream) a shared responder.                                                                                                                           |
| OQ-6  | **Install footprint**: 137 MB / 26 600 files land on the CCU's eMMC/SD through the palette manager; how long does the install take, and does npm's shallow strategy cope?                                                                                        | Measure on the OpenCCU VM and a real CCU3 in task 15. In parallel ask upstream (matter-js/matter.js) for a publish without `src/` and `*.map` (halves it); a `files` change there costs nothing. Not solvable on our side — `npm install` cannot strip.                                                          |
| OQ-7  | **answered 2026-09-02 by the maintainer: RedMatic's start script** creates the link-local address at boot (task 13). The bridge node only checks and reports (D-14); the sysctl-writing checkbox hm2matter had is **not** carried over.                          | Needs the RedMatic roadmap task before the first hardware run on a CCU3 with the official firmware; on OpenCCU (no boot-order defect seen so far) nothing to do.                                                                                                                                                 |
| OQ-8  | **answered 2026-09-02 by the maintainer: Apple Home and Alexa are both release targets for 1.0.0**; Home Assistant stays the diagnostic instrument, Google Home after 1.0.0.                                                                                     | Consequences: the first bridge node defaults to port 5540 and the help says Alexa finds only that one; the device list warns past 50 selected endpoints (Alexa) and 150 (Apple); the hardware gate pairs Apple and Alexa on the same bridge through the multi-admin window (sammachin #33/#58 was exactly that). |
| OQ-9  | Sharing `roles.js`, fixtures and the fake ccu with RedMatic-HomeKit: copy or extract a package?                                                                                                                                                                  | Copy now, extract when the first bug has to be fixed in both (hm2matter M-3/OQ-6 reasoning). Candidate name: `@rdmtc/homematic-roles`.                                                                                                                                                                           |
| OQ-10 | Thermostat semantics: HomeKit had a shared `lib/thermostat.js` (setpoint/mode/off = 4.5 °C, boost switch). Matter's Thermostat cluster has `systemMode` Off/Heat and `occupiedHeatingSetpoint`; where does boost go?                                             | Port hm2matter's thermostat mapper (already handles the three setpoint variants and Off ↔ 4.5 °C), express boost as an extra `OnOffPlugInUnit` endpoint option ("BoostSwitch", as HomeKit does) — Matter's ModeSelect is not rendered by Apple Home.                                                             |
| OQ-11 | Colour lights (HmIP-RGBW, HM-DW-WM): `ExtendedColorLight` with HS + colour temperature, or two options?                                                                                                                                                          | One `ExtendedColorLight` when the channel has HUE/SATURATION, `ColorTemperatureLight` when it has only COLOR_TEMPERATURE. After 1.0.0 unless a fixture makes it cheap (task 16).                                                                                                                                 |

## 6. Project skeleton and tooling

Status 2026-09-04: **done in 1.0.0-dev.0** (everything below; `.npmignore`
is not needed because `files` whitelists `nodes/` and `CHANGELOG.md`; the
icon is one `nodes/icons/matter.svg`; `smoke-local.sh` browses with
`dns-sd` or `avahi-browse`, whichever exists). Stays here until the CI run
on GitHub and the palette install of task 15 confirm it, then moves to the
archive.

Copy the shape of RedMatic-HomeKit, not the code:

- `package.json`: name `redmatic-matter`, `node-red.nodes` for the six
  node types, `engines` per D-3, `files` whitelist (`nodes/`,
  `CHANGELOG.md`), dependency `@matter/main` pinned per D-11, dev deps
  ESLint 9 / Prettier / `eslint-plugin-html` / globals; scripts `lint`,
  `format`, `test`, `test:unit`, `check:native`.
- `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`,
  `.gitignore`, `.npmignore` from HomeKit.
- `tools/check-native.js` (with the `@matter/nodejs` allowlist),
  `tools/smoke-local.sh` (pack, shallow-install into a fresh Node-RED 5,
  start, browse `_matter._tcp` with `dns-sd`, read the pairing code from the
  admin endpoint).
- `.github/workflows/ci.yml` (lint, native scan, Node 22/24 × Node-RED 4/5)
  and `release.yml` (tag `v*` → npm publish with OIDC provenance + GitHub
  release from `CHANGELOG.md`); npm trusted publisher to be configured by
  the maintainer for `rdmtc/RedMatic-Matter`.
- `AGENTS.md` (+ `CLAUDE.md` → `@AGENTS.md`), `CHANGELOG.md`, `LICENSE`
  (Apache-2.0), `README.md` (German) + `README.en.md`, `HANDOFF.md`,
  `roadmap-archive/`.
- Icons: a Matter-style icon pair for `nodes/icons/`.

## 7. Matter core in CommonJS

Status 2026-09-04: **done in 1.0.0-dev.0** as `nodes/lib/matter.js`
(loader, `MatterBridge`, `Device`), `devices.js` (22 types, every
type/option combination instantiated in the tests), `commands.js` (door
lock, window covering, thermostat, identify; D-19) — with two departures
from the text below: there is no separate `bridge-loop.js`, the CCU side of
the loop lives in `hm-device.js` (task 10) because the write rules
(deferred bare on, echo suppression by actor context) are the only
Homematic-agnostic part and they fit in a few lines there; and OnOff /
LevelControl / ColorControl / FanControl are attribute-driven, not hooked —
a remote `moveToLevelWithOnOff` changes both attributes in one transaction
and the level write supersedes the deferred bare on, which is one CCU
write as intended. The acceptance list below is `test/matter.test.js`
(remote-actor context excepted: that needs a controller, task 15).

`nodes/lib/` — the port of hm2matter's Matter layer, nothing Node-RED
specific in it so it stays testable with `node --test` alone:

- `matter.js`: `init(RED)` sets the storage root once
  (`Environment.default.vars.set('storage.path', <userDir>/matter)`, a
  process-wide setting exactly like HomeKit's `HAPStorage`; matter.js
  then keeps `<root>/<node id>` per bridge), and returns the library
  handle every node uses through `bridgeConfig.matter`. Load matter.js
  lazily on first use — `require('@matter/main')` costs 2–4 s and
  ≈ 166 MB RSS, which a Node-RED without a bridge node should not pay.
  `MatterBridge` class per bridge config node: `start()` (ServerNode with
  `id` = bridge id, port, passcode, discriminator, product description,
  basic information incl. software version from `package.json`),
  aggregator, `addDevice`/`removeDevice`/`setState`/`setReachable`,
  `pairingCodes`, `fabrics` (index, vendor id, label, node id),
  `removeFabric(index)`, `openCommissioningWindow()`, `factoryReset()`,
  `stop()`. Several `MatterBridge` instances share one
  `Environment` (and thereby one mDNS service); verify in a test that two
  nodes on two ports start, commission-advertise and stop cleanly.
- `matter-devices.js`: hm2matter's definitions plus what task 9's universal
  node and task 10's wider mapping need (colour lights, fan, pressure/flow,
  air quality, water valve, on/off light switch is _not_ offered — it is a
  controller-side type). One place for feature selection and composition;
  mappers and nodes name device types as strings.
- `bridge-loop.js` (hm2matter `bridge.js`): unchanged semantics — echo via
  the actor context (`hasLocalActor(context)` from `@matter/main/protocol`
  replaces the now deprecated `context.offline`), coalescing, movement hold, presses, maintenance
  channel — with `write` injected by the node (ccu `setValueQueued` for
  one datapoint, `methodCall('putParamset')` for several). One correction
  from matterbridge-homematic FIX-0: hm2matter's 20 ms window drops a
  `restore` write ("on, at whatever you were" = `LEVEL 1.005`) only when
  the level arrives almost at once, but Alexa voice sends "on" and the
  level as two directives up to ~400 ms apart. So a **bare on is deferred
  ~500 ms** and cancelled by a level write in that window, a bare on is
  ignored when the light is already on, and explicit values are never
  delayed. Tests: on-from-off-with-level is one LEVEL write, bare on fires
  after the window, off is immediate.
- `commands.js`: the piece hm2matter left open — command handlers for the
  clusters Matter drives by command: DoorLock `lockDoor`/`unlockDoor`/
  `unboltDoor`, WindowCovering `upOrOpen`/`downOrClose`/`stopMotion`/
  `goToLiftPercentage`/`goToTiltPercentage` (matter.js' extension point is
  `handleMovement()`, not the commands themselves), OnOff `on`/`off`/`toggle` and
  LevelControl `moveToLevel`/`moveToLevelWithOnOff` on dimmers (the
  command carries the whole intent — level plus implicit on — so it becomes
  one CCU write; `move`/`step` and scene recalls still land as attribute
  changes and keep the attribute path as fallback), Thermostat
  `setpointRaiseLower`, Identify. Implemented once as behavior subclasses
  in plain JS (`class extends DoorLockServer { lockDoor() {…} }`) that call
  back into the loop's `handleCommand`.
- IPv4/IPv6 and interface settings pass through to matter.js
  (`mdns.ipv4`, `mdns.networkInterface`, network `port`).

Acceptance: `node --test` starts real ServerNodes on scratch ports, adds a
composite endpoint, writes state, receives a simulated controller write
(online context) and a command, removes the endpoint, restarts the node from
the same storage and sees the same endpoint number.

## 8. Bridge config node

Status 2026-09-04: **done in 1.0.0-dev.0** (`nodes/redmatic-matter-bridge.*`,
admin endpoints `GET /redmatic-matter/bridge?config=|suggest=1` and
`POST /redmatic-matter/bridge/:id/:action`, dialog polling every 3 s).
Departures: "open commissioning window" uses
`agent.commissioning.enterCommissionableMode()` because
`administratorCommissioning.openBasicCommissioningWindow()` requires a
remote session in matter.js 0.17.9; removing a fabric uses
`Fabric.leave()` from the `FabricManager` for the same reason. Both are
untested against a real controller (task 15). The commissioning date is
not recorded by matter.js and is not shown.

`redmatic-matter-bridge`, the counterpart of the HomeKit bridge dialog:

- Fields: **Name** (announced name), **Bridge id** (suggested random,
  "do not change after pairing", D-4), **Port** (default 5540, each bridge
  its own; matter.js binds it without reuse, and Alexa only ever looks at
  5540 — say so in the help), **Passcode** (suggested random 8-digit, excluding the invalid
  ones the spec lists), **Discriminator** (suggested random 12-bit),
  **IPv4** (default on), **IPv6-only mDNS** (default off, D-5),
  **Network interface** (default all), vendor/product id under "advanced".
- Dialog shows, from an admin endpoint (`GET redmatic-matter?config=<id>`,
  `redmatic-matter.read` permission): the QR code (client-side from
  `qrPairingCode`, the QR library HomeKit inlines) and the manual code
  while a commissioning window is open, and — **like matterbridge's
  frontend** (requested by the maintainer 2026-09-02) — the **list of
  paired fabrics** from `server.state.commissioning.fabrics`: fabric
  index, controller vendor resolved from `rootVendorId` (Apple 0x1349,
  Google 0x6006, Amazon 0x134F, Samsung SmartThings 0x10E1, Home
  Assistant 0x1385, ioBroker/matter.js test 0xFFF1, otherwise the hex id),
  the fabric `label` the controller set, node id and the commissioning
  date if matter.js records one. Each row gets a **Remove** button
  (`server.commissioning.removeFabric(index)` behind a confirm), so one
  controller can be unpaired without factory-resetting the others. Below
  the list: buttons **Open commissioning window** (the multi-admin path
  for adding Alexa next to Apple Home) and **Factory reset** (confirm
  dialog), all on `POST` endpoints with `redmatic-matter.write`. The
  list refreshes on the `fabricsChanged` event while the dialog is open
  (poll the endpoint every few seconds; there is no push channel into
  the editor).
- Runtime: registry keyed by bridge id (D-8), `ready` promise the other
  nodes await, and **start only when every node that feeds it has added
  its endpoints** — HomeKit's `waitForAccessories`/`waitForHomematic`
  timer, kept for the reason D-8 gives (the hub deletes endpoints it does
  not see at subscription time; sammachin's bridge waits for all its
  child nodes the same way). Node status text: pairing code while uncommissioned, "N
  fabrics, M endpoints" afterwards, red with the reason on port/IPv6
  failures (D-5, D-14).
- Close handling: on redeploy keep the ServerNode; on node deletion stop it
  and leave the storage in place (a deleted bridge whose id is recreated
  gets its fabrics back — document).
- Log the pairing code once at start like hm2matter does, so a headless
  install can pair without the editor.

## 9. Generic nodes: switch, pseudobutton, programmable switch, universal

Status 2026-09-04: **done in 1.0.0-dev.0** (`test/nodes.test.js`). The
universal node's list entries are `{type, name, battery, humidity,
illuminance, tilt}`; controller writes are simulated in the tests by
invoking the change listeners with a remote context — the real remote
path is task 15.

Port of the HomeKit nodes with the same dialogs:

- **switch**: option "as" → plug-in unit (default) / light; input
  `msg.payload` boolean → `onOff`; output on controller writes only (echo
  filtered by the actor context), `msg.payload` boolean.
- **pseudobutton**: plug-in unit endpoint; a controller write to on emits
  the configured payload/topic (same `payloadType` handling as HomeKit) and
  the endpoint returns to off after 250 ms.
- **programmable switch**: count N; N `GenericSwitch` endpoints (momentary,
  release, long press, multi-press features; `longPressDelay` and
  `multiPressMax` set as in hm2matter); input `msg.topic =
<button>/<short|long|double>` performs the press sequence through the
  bridge loop's `presses` mechanism. Apple Home shows single/double/long.
- **universal**: editable list of endpoints (device type + name), message
  contract of section 3; `msg.payload` object → several attributes; output
  for controller writes and commands with `msg.topic` naming the path and
  `msg.payload` the value/command fields. Help text carries recipes:
  a colour light from zigbee2mqtt, a temperature sensor from a system
  variable, a door lock from a script.
- All four: reachable flag from an optional `msg.reachable`, identity per
  D-4.

## 10. Homematic devices node

Status 2026-09-04: **done in 1.0.0-dev.0** (`nodes/lib/mapping.js`,
`hm-device.js`, `catalogue.js`, `nodes/redmatic-matter-homematic-devices.*`;
`test/mapping.test.js`, `hm-device.test.js`, `catalogue.test.js`,
`mapping.snapshot.json` over the 385 fixtures). Departures and details:
the battery percentage derives the cell count from the voltage itself
(≤ 1.7 V one cell, ≤ 3.4 V two, ≤ 5 V three, else four; 1.0–1.5 V per
cell) instead of a per-model table; the search box is there, the
room/function filter is not yet (needs ccu's rega metadata in the
catalogue); the endpoint count warns past 50 and 150, the RAM threshold of
OQ-4 waits for the measurement; `lock_state` (HmIP-DLS) is a door lock
that re-asserts the real state after a command; HmIP-RCV-50 is opt-in;
valve channels are plug-in units; energy channels are listed as
"follows after 1.0.0". Boost is an opt-in extra plug per thermostat.

`redmatic-matter-homematic-devices` — the heart of the package.

1. **Catalogue endpoint** (`GET redmatic-matter/homematic-devices?config=`),
   port of HomeKit's `lib/catalogue.js` + `lib/generic.js#plan()`: for every
   device of the enabled interfaces the channels, their detected role, the
   device types they can become and the options to offer. Unknown devices
   are listed as "no Matter equivalent" with their channel types, so a bug
   report contains what is needed.
2. **Role detection**: HomeKit's `roles.js` (CONTROL hint → channel type →
   datapoint names, HmIP virtual-receiver selection, ignored infrastructure
   channels) copied, feeding hm2matter's mappers keyed by role instead of by
   raw channel type. New roles over hm2matter: HmIP locks (`DOOR_LOCK_*`),
   valves (`WATER_SWITCH.STATE`), rain, CO₂, jalousie (`LEVEL_SLATS`),
   window drives, light sensors, colour lights. Garage (`DOOR_RECEIVER`)
   and valve roles are detected so the list can say "stays on
   RedMatic-HomeKit" (D-16) instead of "unknown".
3. **Mapping table** (role → device types and options), first release:
   switch → plug-in unit / light (option); dimmer → dimmable light;
   colour → ExtendedColorLight (OQ-11); blind/shutter → window covering,
   slats when `LEVEL_2`/`LEVEL_SLATS` exist; contact/rotary handle/tilt →
   contact sensor; motion/presence → occupancy (+ light sensor when the
   channel has lux, never for HM's 0..255 index, hm2matter M-18);
   smoke → smoke alarm; water → leak detector; rain → rain sensor;
   weather → temperature + humidity (+ light) composite; CO₂ → air quality
   sensor with CO₂ measurement; thermostats (HM, HmIP, groups) →
   thermostat heating-only + humidity composite, boost as option (OQ-10);
   KEYMATIC + HmIP-DLD/DLS → door lock; keys/buttons → generic switch
   (opt-in on actuators, on by default on remotes); energy → plug-in unit +
   electrical measurement later (task 16); LOWBAT/LOW_BAT → PowerSource
   battery (option "Battery"); UNREACH → `reachable`.
4. **Editor**: HomeKit's device table verbatim in structure (device row with
   checkbox, channel rows with checkbox and dropdowns, "enable all" /
   "disable all", spinner, "deploy the CCU node first" message), opt-in
   default per D-7, search box and room/function filter (hm2matter M-9;
   ccu's `channelNames`/rega metadata make it cheap), a count of selected
   endpoints with warnings at 50 (Alexa) and 150 (Apple) and at the
   measured RAM threshold of OQ-4.
5. **Runtime**: `ccu.register(this)`, `setStatus` drives publish (as
   HomeKit); on connect: plan every selected device, `bridge.addDevice` per
   channel, `ccu.subscribe({cache, change, stable, datapointName})` per
   datapoint the mapping names, feed the bridge loop; writes through
   `setValueQueued` / `putParamset`; on close: unsubscribe, deregister,
   remove endpoints only when the node is deleted (D-8). Endpoint labels
   from `channelNames` (Matter limits `nodeLabel` to 32 characters —
   truncate and say so in the help); a rename in the CCU updates
   `nodeLabel` at runtime when ccu reloads its names (matterbridge-homematic
   RN-0) — which reaches Google/Alexa/Home Assistant but not Apple Home,
   which copies the name once at add time and keeps its own (appendix A;
   say so in the help) — and the per-address config never keys on names.
   Changing a channel's "as what" type rotates the endpoint identity (D-8).
6. **Battery and power**: PowerSource `Battery` when the maintenance
   channel has `LOWBAT`/`LOW_BAT` (BidCos mains actuators report LOWBAT too
   — HomeKit's rule: battery only when the BidCos device has no actuator
   role), `batChargeLevel` from the flag, `batPercentRemaining` from
   `OPERATING_VOLTAGE` with the voltage ranges matterbridge-homematic
   collected (2×AA 2.0–3.0 V default, 1×AA/AAA 1.0–1.5 V for SRH/SWD);
   PowerSource `Wired` otherwise. POWERMETER channels composed onto their
   switch endpoint as electrical measurement come in task 16.

## 11. Tests, fixtures and CI

Status 2026-09-04: **done in 1.0.0-dev.0** except the Node-RED 4/5
registration smoke on CI (`tools/smoke-local.sh` exists; CI runs
`node --test` on Node 22/24 × Node-RED 4/5 as in HomeKit, the first run on
GitHub is pending the push). Test files bind real UDP ports spread by pid
(`test/helpers/matter-harness.js`); `mapping.snapshot.json` replaces the
"round-trip every mapping" idea together with the device-type
instantiation test.

- `test/helpers/`: `fake-red.js`, `fake-ccu.js`, `fixtures.js` from
  HomeKit; a `matter-harness.js` that starts a real ServerNode on a scratch
  port per test file (hm2matter's `test/mapping.test.js` pattern).
- `test/fixtures/devices/` — the 383 pydevccu fixtures (MIT) regenerated by
  HomeKit's `tools/fixtures-from-pydevccu.js`, plus hm2matter's
  `paramsets.json` for the mapper tests.
- Snapshot tests: role per channel and mapping per device for the whole
  fixture set (`roles.snapshot.json`, `mapping.snapshot.json`), reviewed
  on change with `UPDATE_SNAPSHOT=1`.
- Round-trip: every mapping instantiated on a real ServerNode (the class of
  bug M-17 found: endpoints that do not initialise).
- Bridge-loop tests from hm2matter (echo, coalescing, movement, presses,
  maintenance) with injected timers.
- Node tests with the fake RED: every node registers, the bridge publishes
  after the first endpoint, the universal node forwards a controller write,
  the pseudobutton resets, the programmable switch emits the three press
  kinds.
- Node-RED 4 and 5 registration smoke (`node-red-node-test-helper` or the
  `smoke-local.sh` route HomeKit uses).
- CI as D-12; the native scan on every push.

## 12. Garage and irrigation — deliberately absent

Not a task to build, a note on why two HomeKit nodes have no Matter
counterpart (D-16) and when that changes:

- **Garage**: Matter ≤ 1.4 has no garage door device type; 1.5 introduced
  _Closure_ (0x0230), which covers garage doors and gates and carries
  semantic tags, but as of mid-2026 neither Apple Home, Google Home nor
  Alexa renders it (appendix A). A `windowCovering` or `doorLock`
  stand-in would show a blind or a lock — no garage tile, no "open the
  garage" grammar, no CarPlay prompt. The maintainer's own garage runs on
  RedMatic-HomeKit's garage node for exactly those reasons, and both
  packages run on one CCU (D-5).
- **Irrigation**: Matter 1.3's `WaterValve` (0x0042) and 1.5's
  `IrrigationSystem` (0x0040) exist in matter.js, and Home Assistant
  renders them, but Apple Home, Google Home and Alexa do not.
- **Trigger to revisit**: an Apple Home release that renders Closure
  (garage) or the valve device types. Then port the HomeKit nodes' logic
  as framework-free state machines (matterbridge-homematic HM-9 sketched
  the garage one: one- or two-channel pulse actuator, `ON_TIME` pulses,
  contacts with polarity, travel timers, obstruction) with the same msg
  contract as the HomeKit nodes, so flows move by swapping the node type.
- Until then: HmIP-MOD-HO / HmIP-WGC / HmIP-WSM channels are listed by the
  homematic node as "no Matter equivalent", the README points to
  RedMatic-HomeKit for garage and irrigation, and the help text of the
  bridge node says the two packages are meant to run together.

## 13. Platform work outside this repo

- **RedMatic** (confirmed 2026-09-02, OQ-7; **still open**: RedMatic 9.0.0
  was released 2026-09-04 without it, so the CCU3 run of task 15 will show
  the red "no IPv6 address" status until it lands — file it in
  `../RedMatic/ROADMAP.md` first): bring up the CCU3's IPv6
  link-local at addon start (`bin/redmatic`: if `eth0` has no `fe80::`
  address, write `disable_ipv6` 1 → 0 and wait for DAD; hm2matter M-13,
  verified harmless on hardware 2026-08-31) — file as a RedMatic roadmap
  task and reference it from D-14. This is the only IPv6 fix; the node
  reports, it does not write. Also: `README`/wiki mention that Matter needs IPv6 on the LAN
  and a controller on the same L2 segment or routed IPv6 + mDNS reflection.
- **node-red-contrib-ccu**: state the consumer contract (section 1) in its
  roadmap as used by two packages now; `putParamset` helper if
  `methodCall` proves awkward for the coalesced writes.
- **RedMatic-HomeKit**: nothing to change; the coexistence test (OQ-5) runs
  against its 4.0.0-dev line.
- **matter.js upstream**: ask for `src/` and source maps to leave the
  published packages (OQ-6); report anything the CJS route trips over.

## 14. Documentation

- `README.md` German first, `README.en.md` (HomeKit's split): what it is,
  install through the palette manager, quick start (bridge node → deploy →
  scan the QR in the Home app), **requirements** (IPv6 on the LAN, UDP
  5540, one Matter controller such as HomePod/Apple TV, Google Nest hub,
  Echo, Home Assistant), device support statement, coexistence with
  RedMatic-HomeKit and what stays there (garage, irrigation, TV — D-10,
  D-16), limits (endpoints per bridge, second bridge recipe).
- Inline help (German) for every node; `locales/` with an English fallback
  from the start rather than retrofitting it as HomeKit is doing.
- Wiki page `Matter` in `rdmtc/RedMatic.wiki`, plus a line in RedMatic's
  README next to HomeKit.
- `device-support.md` with a "verified on hardware / controller" column,
  written from what task 15 actually saw (hm2matter's plan, matterbridge's
  precedent).
- `HANDOFF.md` at the end of each session.

## 15. Hardware verification and release 1.0.0

Gate before the first tag:

- Green `ci.yml`.
- Palette install on the OpenCCU test box (172.16.23.119, RedMatic
  9.0.0-dev.11, the HomeKit smoke flow is installed there) and on real
  CCU3 hardware: install time and disk (OQ-6), all node sets register,
  bridge announces on `_matterc._udp`, pairing code visible in the dialog.
- **Coexistence** (D-5/OQ-5): `redmatic-homekit` and `redmatic-matter` in
  one Node-RED on the box, both paired, both discoverable after restarting
  either.
- Commission from **Home Assistant** (OQ-8, diagnostic), then **Apple
  Home** with a HomePod/Apple TV on the same IPv6 segment (the house
  network needs the VLAN work hm2matter OQ-1b describes, or the OpenCCU
  box on the main LAN), then **Alexa** on the same bridge through the
  multi-admin window (bridge on port 5540, ≤ 50 endpoints):
  devices appear with names, rooms survive a Node-RED restart and a
  redeploy (D-8), a write from the Home app reaches the CCU, a CCU event
  reaches the Home app, a deleted node removes its device, a re-added
  bridge id keeps its fabrics.
- Device verification with the maintainer's CCU (64 device types) via
  node-red-contrib-ccu; reporter feedback for HmIP-DLD, BROLL-2, eTRV-_,
  WTH-_, SMI55, DRDI3.
- RAM/endpoint measurement (OQ-4) → number in the help and the README.
- npm trusted publisher configured; `v1.0.0-dev.N` tags publish to `next`
  for testers; release notes German with English summary.

## 16. After 1.0.0

- System variables and programs as endpoints (a boolean variable as a
  plug-in unit, a program as a pseudobutton; hm2matter OQ-7,
  matterbridge-homematic HM-8): identity from the ReGa id, never the name;
  state through ccu's sysvar polling/pseudo-push, execution through
  `ccu-program`'s path. Probably a `redmatic-matter-sysvar` node rather
  than a mode of the homematic node.
- Energy: `ElectricalPowerMeasurement`/`ElectricalEnergyMeasurement` on
  POWERMETER channels (Matter 1.3) once a controller shows them.
- Colour lights (OQ-11), fans (`FanDevice` for switch channels driving
  fans), HmIP-BSL LEDs, sirens (`OnOffPlugInUnit` + `Identify`).
- Thermostat cooling/auto modes for HmIP-WTH-2 with cooling, floor heating
  (FALMOT) as thermostats per channel.
- Google Home and Alexa verification; `device-support.md` per controller.
- Composite endpoints in the universal node (a light with a temperature
  sensor on one endpoint).
- Second bridge recipe automation (split the device list across bridges
  when a controller's cap is hit).
- Extract the shared Homematic role layer with RedMatic-HomeKit (OQ-9).

## A. Research notes (2026-09-02)

Web research (registry metadata, matter.js repo and docs, ecosystem
tables, existing Node-RED packages), verified where it says so with
scratch scripts on Node 24.20 / matter.js 0.17.9.

**matter.js**

- Latest `@matter/main` / `@matter/nodejs`: **0.17.9 (2026-08-06)**;
  `dev` tag carries 0.18.0 nightlies since 2026-08-07. Matter spec
  coverage: 1.4.2 → 0.16, 1.5.1 → 0.17.0, **1.6 → 0.17.5+** (no breaking
  changes in the 0.17 patch line). Minor releases every 4–6 months with
  breaking changes, patches every 1–3 weeks. 0.18 (in progress) renames
  the controller API and tightens conformance on the device side
  (`transitionEndTimeMs` → `transitionEndTime`, default servers no longer
  inherit internally enabled features, provisional cluster elements off
  by default, stricter FeatureMap checks). No "1.0" and no `ServerNode`
  rename announced; the "Matter.js Server 1.0" news is a separate OHF
  product. Maintainer works on matter.js full-time at the Open Home
  Foundation since 2025-12.
- Engines: `@matter/nodejs` `>=20.19 <22 || >=22.13`; `@matter/main` has
  none. Dual **CJS + ESM** in every package (`main: dist/cjs/index.js`,
  `exports` with `require` conditions for `.`, `./devices/*`,
  `./clusters/*`, `./behaviors/*`, `./endpoints/*`, `./protocol`,
  `./node`, `./model`); no top-level await; `require('@matter/main')`
  verified (cold ≈ 2–4 s, **RSS ≈ 166 MB right after require**).
  `hasRemoteActor`/`hasLocalActor`/`MdnsService` come from
  `@matter/main/protocol`, not the root. `@matter/main/general` does not
  exist as a subpath.
- Size (registry `unpackedSize`): ≈ 59 MB / 26 600 files across the seven
  packages plus `@noble/curves` (pure JS); ≈ 139 MB on disk because of
  4 KB blocks. **No native modules**; BLE (`@matter/nodejs-ble`) is not a
  dependency; `node:sqlite` is only touched when `storage.driver=sqlite`
  is chosen (default `file`).
- **Several `ServerNode`s in one process work** (verified: two nodes on
  5541/5542 in one `Environment.default`, both online, endpoint numbers
  independent). `MdnsService` is one per environment and shared. Storage:
  `storage.path` is environment-wide; each node gets
  `<storage.path>/<node id>` — one root with a subdirectory per node id is
  the designed layout, node ids must be unique per process. Re-pointing
  `storage.path` per node (KNX-Ultimate does it under a mutex) is racy and
  not needed.
- mDNS: `UdpMulticastServer` binds udp4 + udp6 on 5353 with
  `reuseAddr: true`, joins `224.0.0.251`/`ff02::fb` per interface, **no
  `SO_REUSEPORT`**. IPv4 socket failure is tolerated, **IPv6 socket
  failure aborts the node**. The operational port (5540) is bound
  _without_ reuse since PR #2547 (2025-10), so two bridges need two ports.
  Options `mdns.ipv4`, `mdns.networkInterface`, per node
  `network.ipv4`, `listeningAddressIpv4/6`. IPv4 operational traffic is
  supported, but no evidence that any controller commissions over
  IPv4-only — IPv6 link-local on the LAN is the requirement.
- **Coexistence precedent**: Homebridge ≥ 2.2 runs matter.js and
  `@homebridge/ciao` (hap-nodejs) in one process — the exact pairing of
  RedMatic-HomeKit + RedMatic-Matter. Known caveat on Linux with an
  avahi-daemon: IPv4 mDNS may reach only one responder
  (`<host>.local` stops resolving over IPv4); Homebridge's mitigation is
  an IPv6-only Matter responder (`disableIpv4`). Neither CCU3 firmware
  nor OpenCCU runs avahi-daemon (HomeKit roadmap task 4), so this is a
  documented switch, not a default.
- Dynamic bridging: `aggregator.add(endpoint)` / `endpoint.delete()`
  (erases stored data) / `endpoint.close()` (keeps it) on a running node;
  `DescriptorServer` updates `partsList` and subscribed controllers get
  the report without re-commissioning. **Endpoint numbers are persisted
  per endpoint `id`** in the node's storage, never reused (verified across
  restart and delete/add). Our rule: every endpoint gets a stable unique
  `id` (CCU channel address, Node-RED node id).
- Actor context: `context.offline` is **deprecated** since 0.16; use
  `hasRemoteActor(context)` / `hasLocalActor(context)` or
  `context.fabric === undefined` (local). Verified with `onOff$Changed`.
- Command handlers in plain JS: `DoorLockDevice.with(class extends
DoorLockServer { lockDoor(req) {…} })` works; WindowCovering's
  extension point is `handleMovement(type, reversed, direction,
targetPercent100ths)` (do not call super for real hardware);
  `OnOffServer.on/off/toggle`, `LevelControlServer.moveToLevel*`,
  `ThermostatServer.setpointRaiseLower`; Generic Switch needs no override
  — driving `switch.currentPosition` 0→1→0 emits `initialPress`,
  `shortRelease`, `multiPressComplete`. Strictness since 0.16 (Matter
  1.4.2 dropped defaults): `DoorLockDevice` needs `lockType`,
  `wrongCodeEntryLimit`, `userCodeTemporaryDisableTime`,
  `supportedOperatingModes` (inverted bits); `WindowCoveringDevice` needs
  `type`, `endProductType`, `configStatus` and the position attributes.
  hm2matter's `matter-devices.js` already carries most of these.
- OS: only IPv6 multicast membership and `SO_REUSEADDR` are needed;
  nothing kernel-4.14-, armv7- or musl-specific found (0 issues).
- 88 device types in `@matter/main/devices` (kebab-case subpaths):
  lights (on-off, dimmable, color-temperature, extended-color), plug-in
  units (on-off, dimmable), mounted controls, switches (on-off-light,
  dimmer, color-dimmer, generic), sensors (contact, occupancy, light,
  temperature, humidity, pressure, flow, rain, water-leak, water-freeze,
  air-quality, smoke-co-alarm, soil, on-off-sensor), door-lock,
  window-covering, closure (+ panel), thermostat, fan, air-purifier,
  pump, water-valve, water-heater, heat-pump, room-air-conditioner,
  appliances, energy (electrical-meter, solar-power, battery-storage,
  energy-evse), media (speaker, basic/casting video player, doorbells,
  cameras, chime, intercom), robotic-vacuum, mode-select, controllers.

**Controllers**

- Apple Home supports (Apple support 102135, matter.js `ECOSYSTEMS.md`,
  Home Assistant Matter Hub matrix): lights of all four kinds, plug-in
  unit, generic switch, contact / light / occupancy / temperature /
  humidity sensors, door lock, window covering, thermostat, fan, air
  conditioner; air quality with concentration clusters from iOS 18.5.
  **Not rendered by Apple Home**: pressure and flow sensors, **water
  valve**, pump, mode select, electrical meter / solar / battery / EVSE,
  water heater, speaker, video player, doorbell, dishwasher and other
  appliances, water-freeze detector; a robot vacuum next to other devices
  destabilises the whole bridge (iOS 18.4). Closure (Matter 1.5/1.6) is
  not rendered by any major controller as of mid-2026.
- Limits: Apple Home ≈ **150 accessories per bridge** (matterbridge
  README, no official Apple number); **Alexa ≤ 50 bridged devices**, only
  discovers **port 5540** and needs the aggregator at endpoint 1 — one
  bridge per host for Alexa users (matter.js `KNOWN_ISSUES.md`); Alexa
  devices are reported to flicker (Amazon side, 2025-10/11). Google
  publishes no number; Nest hubs are reported to drop bridged devices
  after a bridge restart and to show new endpoints only after a hub
  restart. Home Assistant has no limit.
- Behaviour after changes (community evidence, consistent across
  sources): Apple Home keys on the endpoint's stable identity and keeps
  rooms and automations across bridge changes, but (a) a bridge that
  comes online with an empty parts list and adds endpoints afterwards
  races the hub's re-subscription and the hub deletes them, (b) the same
  identity with a different device-type shape yields broken, uneditable
  accessories, (c) Apple copies names once at add time and ignores later
  `nodeLabel` changes ("Apple Home ignores bridge and device names",
  knx-ultimate), (d) removing a bridge in the Home app leaves the fabric
  on the bridge side. Alexa re-imports every device on bridge changes and
  drops rooms/groups. Spec side: `BridgedDeviceBasicInformation.uniqueId`
  must persist, `configurationVersion` (1.4.2) is incremented on
  configuration changes (matter.js 0.17.5 API), removal emits `Leave`.
- Type coverage details: Apple renders smoke/CO alarm and water leak
  detector since iOS 18.4, air purifier since iOS 18, generic switch with
  single/double/long press; Google does not list generic switch as
  supported; Alexa lacks generic latching switches, valves, leak/rain,
  media and energy types. Tilt-only covers get 0 %/100 % only from Apple.
  Apple's rendering of CO₂ through the air-quality sensor is unverified.
  There is no Matter device type for a security system, a garage door
  (before Closure), a humidifier or a doorbell that Apple renders.
- Commissioning: on-network commissioning through `_matterc._udp` plus
  QR/manual code needs no Bluetooth on any controller; Apple needs no home
  hub since iOS 18 for adding and local control (a hub for Thread and
  remote access); Google needs a Nest hub and a phone with BLE for its
  own flow; Alexa an Echo; multi-admin sharing from the Home app opens a
  15-minute window on the bridge (`allowBasicCommissioning`), which is
  what the bridge dialog's "open commissioning window" button is for.
  Controllers in another VLAN need routed ULA addresses and mDNS
  reflection; link-local does not cross a router (hm2matter OQ-1b).
- Existing Node-RED packages, and what their issue trackers teach:
  `@sammachin/node-red-matter-bridge` 0.12.3 (matter.js 0.12, most used;
  redeploy closes and recreates the ServerNode, "endpoint IDs must be
  unique within parent" on partial redeploys, renames not propagated
  (#65), lost pairings when storage moves (#77), crash on stored fabric
  validation after deploy (#50), composed devices unsupported;
  `msg.eventSource` marks controller writes), `@faxioman/
node-red-contrib-matter-dynamic` 0.2.4 (matter.js 0.13; builds any
  device type from its name via `require('@matter/main/devices')[type]`
  and `requirements.server.mandatory` — the pattern for our universal
  node; two outputs: attribute changes and commands),
  `@jpadie/node-red-virtual-matter-devices` 0.3.15 (0.13, TypeScript),
  `node-red-contrib-knx-ultimate` 7.0.1 (2026-09-02, matter.js 0.17.9:
  keeps the ServerNode across redeploys and reconciles endpoints live,
  reset-pairing button, export/import of the storage, notes "Apple Home
  ignores names" and that profile changes may need a reset),
  `@node-red-matter/node-red-matter` 0.3.1 (2023, abandoned). None by
  FlowFuse. Storage default in matter.js is `~/.matter`; every package
  overrides it into the Node-RED user directory.
- Homematic-side landscape: **nobody offers Matter on the CCU itself** —
  OpenCCU closed "Matter bridge" (#2342) as wontfix in 2023-09 and only
  ships a Thread border router add-on, eQ-3 has announced nothing (not a
  CSA member; the HCU plug-in programme is dormant), Home Assistant is a
  controller and needs the community Home-Assistant-Matter-Hub fork
  (RiDDiX, matter.js based) to bridge out, ioBroker.matter 1.3.1 runs on
  matter.js 0.17.9 with a cloud licence check, openHAB 5 bridges items,
  CCU-Jack has no Matter, matterbridge-homematic needs a matterbridge
  host (some run it as an OpenCCU addon, matterbridge #464), hm2matter is
  archived (D-15). This package is the only path to a Matter bridge
  running on the CCU through the palette manager.

**Verified 2026-09-04 (implementation session, matter.js 0.17.9 on Node
24.16 / WSL Debian, scratch scripts and the test suite)**

- Cold `require('@matter/main')` ≈ 1 s and 181 MB RSS on a desktop;
  install through npm: 141 MB, 26 600 files, 9 production packages, none
  native (`tools/check-native.js`).
- `ServerNode.create({id, network: {port}, commissioning: {passcode,
discriminator}, productDescription, basicInformation})`, aggregator via
  `new Endpoint(AggregatorEndpoint, {id: 'aggregator'})`, bridged devices
  via `Type.with(BridgedDeviceBasicInformationServer)`; storage lands in
  `<storage.path>/<node id>/` with one file per persisted attribute,
  endpoint numbers per endpoint id (`root.parts.aggregator.parts.<id>.__number__`)
  — same number after restart, `close()` keeps it, `delete()` erases it.
- Device types whose default behaviour set is only `identify`:
  `WindowCoveringDevice`, `ThermostatDevice`, `GenericSwitchDevice` — the
  cluster server must be added with `.with(XServer.with(...features))`
  or the endpoint has no such state. `DoorLockDevice`'s default server
  enables every credential feature; `DoorLockServer.with()` (no features)
  needs only `lockState`, `lockType`, `actuatorEnabled`, `operatingMode`
  (`supportedOperatingModes` is defaulted by matter.js and uses inverted
  bits; `wrongCodeEntryLimit`/`userCodeTemporaryDisableTime` are PIN-only
  and rejected without the feature). Colour lights need `colorMode` and
  `enhancedColorMode` plus `colorTemperatureMireds` inside the physical
  min/max. `WindowCovering.goToLiftPercentage` takes
  `liftPercent100thsValue`; the extension point `handleMovement` receives
  the target only for `DefinedByPosition` moves — the command hooks are
  the reliable place. GenericSwitch with the four momentary features emits
  `initialPress`/`shortRelease`/`multiPressComplete` for a 1→0 position
  transition, `longPress`/`longRelease` past `longPressDelay`.
- Actor context: `hasLocalActor(context)` is true for our `set()`,
  `endpoint.act()` and reactor changes; `hasRemoteActor` for controller
  traffic (not exercised here). `$Changed` events fire on commit with
  `(value, old, context)`.
- Locks: a `set()` holds the behaviour's state lock for the storage commit
  (tens of ms on the first write); command handlers that write state
  synchronously fail in that window unless they await
  `transaction.addResources(this)` + `transaction.begin()` first (D-19).
- Commissioning: `administratorCommissioning.openBasicCommissioningWindow`
  and `operationalCredentials.removeFabric` throw "requires an
  authenticated remote session" from a local actor; the local entry points
  are `agent.commissioning.enterCommissionableMode()` and
  `FabricManager.fabrics[i].leave()`. `ServerNode.erase()` on a running
  node cannot be closed afterwards (D-18). `close()` flushes storage
  before it resolves; deleting the storage directory right after an
  `erase()` crashes on a deferred `events.lastEventNumber` write.
- Two ServerNodes in one `Environment.default` on two ports start, run and
  stop cleanly; a UDP port in use is detected by a pre-flight bind before
  matter.js sees it. `mdns.ipv4` and `mdns.networkInterface` are
  environment variables, i.e. process-wide: the first bridge's setting wins
  (documented in the bridge help).

## B. HomeKit service → Matter device type

| HomeKit service (redmatic-homekit)     | Matter device type (matter.js)                                     | Note                                                                  |
| -------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Switch / Outlet                        | `OnOffPlugInUnitDevice`                                            | Matter's "on/off light switch" is a controller-type device, not this  |
| Lightbulb (on/off, brightness)         | `OnOffLightDevice`, `DimmableLightDevice`                          |                                                                       |
| Lightbulb (colour temperature, HS)     | `ColorTemperatureLightDevice`, `ExtendedColorLightDevice`          | OQ-11                                                                 |
| Fan                                    | `FanDevice`                                                        | after 1.0.0                                                           |
| Valve / IrrigationSystem               | —                                                                  | D-16: Apple Home does not render `WaterValveDevice`; stays on HomeKit |
| WindowCovering (+ slats)               | `WindowCoveringDevice` (Lift / Lift+Tilt, position aware)          |                                                                       |
| Door / Window                          | `ContactSensorDevice`                                              | Matter has no door/window "device" beyond the contact sensor          |
| GarageDoorOpener                       | —                                                                  | D-16: no rendered Matter type (Closure unsupported); stays on HomeKit |
| LockMechanism                          | `DoorLockDevice`                                                   | command driven (`lockDoor`/`unlockDoor`)                              |
| Thermostat                             | `ThermostatDevice` (Heating)                                       | OQ-10 for boost                                                       |
| TemperatureSensor / HumiditySensor     | `TemperatureSensorDevice` / `HumiditySensorDevice`                 | composed on one endpoint for a weather channel                        |
| LightSensor                            | `LightSensorDevice`                                                | lux only (M-18)                                                       |
| ContactSensor                          | `ContactSensorDevice`                                              |                                                                       |
| MotionSensor / OccupancySensor         | `OccupancySensorDevice` (PIR)                                      | Matter has no separate motion sensor                                  |
| SmokeSensor                            | `SmokeCoAlarmDevice` (SmokeAlarm)                                  | Apple since iOS 18.4                                                  |
| LeakSensor                             | `WaterLeakDetectorDevice`                                          | Apple since iOS 18.4; Google/Alexa do not render it                   |
| CarbonDioxideSensor / AirQualitySensor | `AirQualitySensorDevice` + `CarbonDioxideConcentrationMeasurement` | Apple rendering of CO₂ unverified                                     |
| BatteryService                         | `PowerSource` cluster (Battery) on the endpoint                    |                                                                       |
| StatelessProgrammableSwitch            | `GenericSwitchDevice` (Momentary, LongPress, MultiPress)           | Apple and Alexa yes, Google not listed                                |
| Television                             | —                                                                  | D-10                                                                  |
| SecuritySystem / Doorbell / Speaker    | —                                                                  | no rendered Matter equivalent; stay on HomeKit                        |
