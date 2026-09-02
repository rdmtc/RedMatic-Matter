# Handoff — RedMatic-Matter (2026-09-02, planning session)

Written by Claude Fable on behalf of hobbyquaker. Nothing is implemented;
`ROADMAP.md` is the whole deliverable of this session and the place to read
first (decisions D-1…D-15, open questions OQ-1…OQ-11, tasks 6–16, research
in appendix A).

## What happened

- The maintainer decided against continuing `../hm2matter` (standalone CCU
  addon) and started this project: Node-RED nodes mirroring
  RedMatic-HomeKit's node set and UX, on matter.js, fed by
  node-red-contrib-ccu, installed through the palette manager on RedMatic 9.
- Two constraints were stated during the session and are decisions now:
  **no matterbridge in any form** (D-1; matterbridge-homematic was mined for
  mapping knowledge only, section 1 of the roadmap lists what was taken) and
  **coexistence with RedMatic-HomeKit in one Node-RED process on one CCU**
  (D-5; all three mDNS responders bind 5353 with `SO_REUSEADDR`, verified in
  the three code bases; Homebridge ≥ 2.2 runs the same pairing).
- Verified on this Mac (Node 24.20, matter.js 0.17.9 from
  `../hm2matter/node_modules`): CommonJS `require('@matter/main')` and its
  subpaths work; zero native modules; 137 MB / 26 600 files footprint.
- Web research (two agents) is condensed in roadmap appendix A: versions,
  multi-ServerNode-per-process (verified), storage layout, mDNS socket
  behaviour, deprecated `context.offline`, command-handler pattern, Apple
  Home's unsupported device types, Alexa's port-5540/50-device limits,
  existing Node-RED Matter packages and their issue trackers.

## Decisions the maintainer gave at the end of the session (2026-09-02)

- Opt-in device list (OQ-1 → D-7 stands).
- RedMatic's start script creates the CCU3's IPv6 link-local; the node only
  checks and warns (OQ-7 → D-14; needs a RedMatic roadmap task).
- Apache-2.0, `1.0.0-dev.N` on master, `redmatic-matter` /
  `rdmtc/RedMatic-Matter` (D-12, D-13).
- Release targets 1.0.0: Apple Home **and Alexa**; Home Assistant as the
  diagnostic controller, Google later (OQ-8).
- No garage and no irrigation node (D-16): both stay on RedMatic-HomeKit,
  which is why the two packages must run side by side (the maintainer's
  garage door with its CarPlay prompt lives there).

## Next steps (roadmap order)

1. Task 6 — skeleton and tooling copied from `../RedMatic-HomeKit`
   (`check-native.js` needs the `@matter/nodejs` optionalDependency
   allowlist).
2. Task 7 — port `../hm2matter/lib/{matter,matter-devices,bridge}.js` and
   `lib/mapping/` to CommonJS under `nodes/lib/`, replace `context.offline`
   with `hasLocalActor()` from `@matter/main/protocol`, add the command
   handlers hm2matter left open, test with real ServerNodes.
3. Tasks 8–10 — the nodes, in that order; the homematic node reuses
   HomeKit's `lib/roles.js`, catalogue endpoint and device-list html.

## Reference material outside this repo

- `../hm2matter` (archived, D-15): `ROADMAP.md` §1–§6 for the hardware
  findings (IPv6 on the CCU3, 5353 sharing, RAM), `test/` as the porting
  checklist, `paramsets.json` (2222 descriptions).
- `../RedMatic-HomeKit`: everything user-facing, `test/fixtures/devices/`
  (383 pydevccu fixtures), `test/helpers/`, CI and release workflows.
- matterbridge-homematic: `git clone --depth 30
  https://github.com/hobbyquaker/matterbridge-homematic` — `device-support.md`,
  ROADMAP items FIX-0, HM-9, HM-8, UX-2, RN-0, `src/ccu/device-power.ts`.
- Test hosts: OpenCCU box 172.16.23.119 (RedMatic 9.0.0-dev.11, HomeKit
  4.0.0-dev.7 installed), see `../RedMatic-HomeKit/HANDOFF.md` for access
  and the admin-API install recipe.
