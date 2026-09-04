# Handoff — RedMatic-Matter (2026-09-04, first implementation session)

Written by Claude Fable on behalf of hobbyquaker. Read `ROADMAP.md` first
(status paragraph, decisions D-1…D-19, tasks 6–16); `AGENTS.md` explains
the layout. Lab systems, addresses and credentials stay out of this file.

## Where things stand

`master` is at **1.0.0-dev.0** (plus four follow-up commits from the same
day): everything in ROADMAP tasks 6–11 is **implemented and green** —
`npm test` locally (lint, 45 unit tests against real matter.js
ServerNodes, native scan), **CI green on GitHub** on all five jobs, and
`tools/smoke-local.sh` green against a fresh Node-RED 5 — but **nothing
has run on a CCU or against a Matter controller yet**; that is task 15
and the next thing to do. No tag, no npm publish; the npm trusted
publisher for `rdmtc/RedMatic-Matter` → `release.yml` still has to be
configured by the maintainer. The RedMatic IPv6 item (task 13 here) is
filed as **RedMatic roadmap task 9** (pushed to `rdmtc/RedMatic` master
2026-09-04) and still needs implementing there before the CCU3 run.

What exists (one `.js` + `.html` per node under `nodes/`, the Matter and
Homematic layers under `nodes/lib/`):

- `matter.js` — lazy matter.js loader (storage root `<userDir>/matter`),
  `MatterBridge` (ServerNode + aggregator per bridge config node, module
  registry keyed by bridge id so deploys keep the node, holds/timeouts so
  the node goes online only after every feeder added its endpoints, IPv6
  and UDP-port pre-flight, pairing codes, fabric list, remove fabric, open
  commissioning window, factory reset), `Device` handles (pending-state
  shadow, `set()`, `onChange` with actor context, `onCommand`).
- `devices.js` — 22 Matter device types with the feature/attribute choices
  that make matter.js 0.17.9 initialise them (every combination is
  instantiated in `test/matter.test.js`); options battery/wired/humidity/
  illuminance/tilt compose extra clusters and are part of the identity key.
- `commands.js` — command hooks for door lock, window covering, thermostat
  and identify; each override does `await transaction.addResources(this);
await transaction.begin()` before calling matter.js (D-19).
- `mapping.js` + `hm-device.js` + `catalogue.js` — the Homematic mapping
  (roles from HomeKit's `roles.js`), the runtime loop and the editor list.
- Nodes: bridge (dialog with QR, code, fabrics, buttons, polling every 3 s),
  switch, pseudobutton, programmable switch, universal, homematic.
- Tests: `test/matter.test.js`, `nodes.test.js`, `hm-device.test.js`,
  `mapping.test.js`, `roles.test.js`, `catalogue.test.js`; 385 fixtures
  copied from RedMatic-HomeKit with `roles.snapshot.json` (identical to
  HomeKit's) and `mapping.snapshot.json`.

## What this session found out (details in ROADMAP appendix A, 2026-09-04)

- `hm2matter` is **not on this machine** (it only ever lived on the Mac);
  task 7 was therefore written from the roadmap's specification against
  the real matter.js API instead of ported. Nothing of hm2matter's code is
  needed any more; its hardware findings are in the roadmap.
- matter.js 0.17.9 API facts that cost time: `WindowCoveringDevice`,
  `ThermostatDevice` and `GenericSwitchDevice` carry only `identify` by
  default — their cluster server must be given explicitly with features;
  `DoorLockDevice`'s default server enables every credential feature (use
  `DoorLockServer.with()`); colour lights need `colorMode` and
  `enhancedColorMode`; `goToLiftPercentage` takes `liftPercent100thsValue`;
  `openBasicCommissioningWindow`/`removeFabric` need a remote session, so
  the dialog uses `agent.commissioning.enterCommissionableMode()` and
  `Fabric.leave()`; `ServerNode.erase()` leaves sockets and the storage
  lock open afterwards, so factory reset closes the node, removes
  `<storage>/<bridge id>` and starts again.
- A `set()` on an endpoint holds its state lock for tens of milliseconds
  (storage write); matter.js' default command handlers lock synchronously
  and fail in that window — hence D-19.

## Next steps (roadmap order)

1. **Task 15, hardware gate — round 1 done on the OpenCCU box** (see the
   results block in ROADMAP task 15): 1.0.0-dev.1 installed as a tarball
   next to redmatic-homekit, paired with the maintainer's **she** dev
   instance (the diagnostic controller from now on; commission and
   command through its HTTP API, `auth: none` on the LAN) and with
   **Apple Home** through the dialog's commissioning window; writes,
   events, restart, key presses, endpoint add/remove and a 57-endpoint
   RAM number verified. The box keeps the "matter smoke" flow tab
   (bridge `lab0001`, port 5540, PDT + WRC2 selected) and the three
   fabrics. Left: Charly/CCU3 (blocked by RedMatic task 9), Alexa (no
   Echo in the lab yet), HomeKit re-browse for OQ-5, redeploy with a
   type change, Home-app automations on WRC2 presses (needs a home hub).
2. **Task 13, RedMatic IPv6.** RedMatic 9.0.0 shipped **without** the
   CCU3 IPv6 link-local fix; filed as RedMatic roadmap task 9, not yet
   implemented. Until then the Charly shows the red "no IPv6 address"
   status.
3. **npm publish**: the first `1.0.0-dev.N` on the `next` tag must be a
   manual `npm publish --tag next` from a logged-in npm (`npm login` in
   WSL; this machine was not logged in) before the trusted publisher can
   be configured. The maintainer asked for exactly that.
4. **Task 14 leftovers**: wiki page, `device-support.md` after task 15.
   English `locales/` help is low priority (maintainer 2026-09-04: nearly
   all users are in the DACH region).
5. **Task 16** items that became cheap: `piHeatingDemand` from valve
   levels, energy measurement, colour lights on real hardware (HmIP-RGBW).

## Working here

```
git clone git@github.com:rdmtc/RedMatic-Matter.git && cd RedMatic-Matter
npm ci
npm test               # lint + unit tests + native scan (must be green before every commit)
npm run format         # prettier + eslint --fix
tools/smoke-local.sh   # packs, installs shallowly into a fresh Node-RED 5, brings a bridge online
UPDATE_SNAPSHOT=1 node --test test/roles.test.js test/mapping.test.js
                       # after an intentional mapping change (review the diff first)
MATTER_TEST_LOG=1 node --test test/matter.test.js   # bridge log lines during tests
```

Versioning: `npm version 1.0.0-dev.N --no-git-tag-version` for every
significant change, commit message `1.0.0-dev.N: …`, push. Commits end
with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` line.

The tests bind real UDP ports (ranges spread by pid) and need an IPv6
address on the host. On this machine the work happens in WSL (Debian, Node
24.16); never through PowerShell.

## Gotchas

- Endpoint id = `<owner id>~<device type key>`; the owner id is the CCU
  channel address or `<node id>/<index>`. Changing a channel's type in the
  editor gives it a new identity on purpose (D-8/D-17).
- `bridge.device(spec)` returns the existing `Device` for the same id and
  detaches the previous listeners — a redeployed node re-attaches by
  calling it again. `removeDevice(id, {erase})`: `erase: true` only when
  the node was deleted or the device unticked.
- The homematic node holds the bridge (`bridge.hold()`) until the ccu
  device list settled and its endpoints exist; the bridge starts anyway
  after 90 s and logs a warning.
- HmIP `<X>_VIRTUAL_RECEIVER` channels are write targets; state is read
  from the preceding `<X>_TRANSMITTER` (`lib/state-source.js`).
- matter.js command handlers must not throw synchronously; the notify
  hook in `commands.js` catches handler errors.
- `Logger.level` of matter.js is set to WARN once at load; set
  `logLevel` in the bridge options for more.
