# Agent instructions — redmatic-matter

Instructions for AI coding agents (Claude Code, etc.) working in this
repository.

## What this is

Node-RED nodes that expose things as a **Matter bridge** through
[matter.js](https://github.com/matter-js/matter.js): a bridge config node,
generic nodes (universal, switch, pseudobutton, programmable switch) fed by
messages, and a Homematic node that reads its data from a `ccu-connection`
config node of
[node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu)
(`../node-red-contrib-ccu` when checked out next to this repo). It is the
Matter sibling of [RedMatic-HomeKit](https://github.com/rdmtc/RedMatic-HomeKit)
(`../RedMatic-HomeKit`): same node set, same editor UX, same conventions.
The main audience runs it inside [RedMatic](https://github.com/rdmtc/RedMatic)
9 on a Homematic CCU3/OpenCCU, installed through the Node-RED palette manager.

**Read `ROADMAP.md` before making changes** — it records the decisions (D-n)
that constrain the work: matter.js directly, nothing from matterbridge (D-1),
no native modules or binaries anywhere in the dependency tree (D-2), pairings
and endpoint identities must survive deploys, restarts and upgrades (D-4,
D-8), generic channel mapping only (D-6), opt-in device selection (D-7),
coexistence with RedMatic-HomeKit in one process (D-5).

## Layout

- `nodes/` — one `.js` (runtime) + `.html` (editor UI, registration, German
  help) pair per node type; `nodes/icons/` editor assets.
- `nodes/lib/` — the Matter layer and the Homematic mapping, nothing
  Node-RED specific, tested with `node --test` against real ServerNodes:
  - `matter.js` — lazy matter.js loader, storage root (`<userDir>/matter`),
    `MatterBridge` (one ServerNode + aggregator per bridge config node, kept
    across deploys in a module registry), `Device` handles (state patches,
    change events with actor context, command handlers).
  - `devices.js` — the Matter device types with the feature choices and
    initial attribute values that make matter.js 0.17 endpoints initialise;
    `build(name, options)` → `{type, state, key}`; the `key` is the identity
    key (endpoint id = `<owner id>~<key>`).
  - `commands.js` — behaviour subclasses whose command handlers notify the
    endpoint's handler (door lock, window covering, thermostat, identify);
    every override acquires the state lock asynchronously first.
  - `pairing.js`, `vendors.js`, `status.js`, `press.js` — helpers.
  - `roles.js`, `state-source.js` — copies of RedMatic-HomeKit's channel
    role detection and HmIP transmitter/receiver logic (ROADMAP OQ-9).
  - `mapping.js` — pure functions: channel role → endpoint plan (device
    type, subscriptions with value conversions, controller writes/commands
    → CCU writes, editor choices); `hm-device.js` executes plans against a
    `ccu-connection` and a `MatterBridge`; `catalogue.js` renders plans for
    the editor's device list.
- `test/` — `node --test` unit tests (`*.test.js`); `test/helpers/`
  (`fake-red.js`, `fake-ccu.js`, `fixtures.js`, `matter-harness.js`),
  fixtures under `test/fixtures/` (385 pydevccu device fixtures shared with
  RedMatic-HomeKit, `roles.snapshot.json`, `mapping.snapshot.json`).
- `tools/` — maintainer scripts, not published (`check-native.js` is the
  D-2 gate run by CI, `smoke-local.sh` installs the packed module into a
  fresh Node-RED and brings a bridge online, `fixtures-from-pydevccu.js` and
  `fixture-from-ccu.js` regenerate/add fixtures).
- `.github/workflows/` — `ci.yml` (lint, native scan, Node 22/24 ×
  Node-RED 4/5) and `release.yml` (tag `v*` → npm publish with OIDC
  provenance + GitHub release from `CHANGELOG.md`).

## Conventions

- Code style: ESLint 9 flat config + Prettier (4 spaces, 120 cols, single
  quotes). `npm run lint` checks, `npm run format` fixes. Let a failing lint
  stop you. Editor scripts inside `nodes/*.html` are linted via
  eslint-plugin-html.
- CommonJS, Node ≥ 22.13, Node-RED ≥ 4 (primary target: Node-RED 5 on
  Node 24, as shipped by RedMatic 9). matter.js is pinned to a minor
  (`~0.17.x`, D-11); bump deliberately with a changelog entry.
- Versioning: `1.0.0-dev.N` on master until the hardware gate (ROADMAP
  task 15); bump N for every significant change, no tags until the
  maintainer says so.
- `CHANGELOG.md` follows Keep a Changelog; describe the user-visible change
  and its reason, not commits.
- Roadmap: stable task numbers, never reused. Completed tasks move to
  `roadmap-archive/task-N.md` and get a ✅ in the ROADMAP contents.
- Docs for users are German first (README.md), English second
  (README.en.md). Code, comments, changelog and roadmap stay English.
- Write a `HANDOFF.md` at the end of a working session so work can continue
  elsewhere. Lab systems, addresses and credentials stay out of the repo.
- Tests start real matter.js ServerNodes on scratch UDP ports (spread by
  pid, see `test/helpers/matter-harness.js`); they need a host with an IPv6
  address. `UPDATE_SNAPSHOT=1 node --test test/roles.test.js test/mapping.test.js`
  after an intentional mapping change (review the diff first).

## Reference material

- matter.js: `node_modules/@matter/*/dist/cjs/**/*.d.ts` is the API of the
  pinned version; the roadmap's appendix A holds what was verified on it.
- HmIP device/channel/datapoint definitions: eQ-3's
  [HmIP_Device_Documentation.pdf](https://www.eq-3.de/Downloads/eq3/download%20bereich/hm_web_ui_doku/HmIP_Device_Documentation.pdf).
- Real paramset descriptions: `../node-red-contrib-ccu/paramsets.json`.
- RedMatic-HomeKit: the UX template; its `homematic-devices/lib/generic.js`
  is the HomeKit counterpart of `nodes/lib/mapping.js`.
