/* lib/roles.js is a copy of RedMatic-HomeKit's role detection (ROADMAP OQ-9);
   the snapshot over the whole fixture set guards it against drift. */

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const roles = require('../nodes/lib/roles');
const fixtures = require('./helpers/fixtures');

/** roles of a fixture type as "<index>:<role>" strings (virtual receivers marked with *) */
function rolesOf(type) {
    const ccu = fixtures.ccuFor(type);
    const iface = ccu.enabledIfaces[0];
    return roles
        .deviceRoles(
            ccu.device,
            (address) => ccu.metadata.devices[iface][address],
            (channel) => ccu.getParamsetDescription(iface, channel, 'VALUES'),
        )
        .filter((c) => c.role && c.role !== 'maintenance')
        .map((c) => `${c.index}:${c.role}${c.virtual ? '*' : ''}`);
}

test('roles of well-known devices', () => {
    assert.deepEqual(rolesOf('HmIP-PSM'), ['1:key', '2:state_only', '3:switch', '4:switch*', '5:switch*', '6:energy']);
    assert.deepEqual(rolesOf('HmIP-BROLL'), [
        '1:key',
        '2:key',
        '3:state_only',
        '4:shutter_hmip',
        '5:shutter_hmip*',
        '6:shutter_hmip*',
    ]);
    assert.deepEqual(rolesOf('HmIP-SWDO'), ['1:contact']);
    assert.deepEqual(rolesOf('HmIP-SRH'), ['1:rotary_handle']);
    assert.deepEqual(rolesOf('HmIP-SMI'), ['1:motion']);
    assert.deepEqual(rolesOf('HmIP-SWSD'), ['1:smoke']);
    assert.deepEqual(rolesOf('HmIP-STHO'), ['1:weather']);
    assert.deepEqual(rolesOf('HmIP-eTRV-2'), ['1:thermostat_hmip']);
    assert.deepEqual(rolesOf('HM-CC-RT-DN'), ['4:thermostat_hm']);
    assert.deepEqual(rolesOf('HM-Sec-Key'), ['1:lock']);
    assert.deepEqual(rolesOf('HmIP-DLD'), ['1:lock_hmip']);
    assert.deepEqual(rolesOf('HmIP-MOD-HO'), ['1:garage', '2:switch']);
});

test('roles snapshot over the whole fixture set', () => {
    const file = path.join(__dirname, 'fixtures', 'roles.snapshot.json');
    const actual = {};
    for (const type of fixtures.types()) {
        actual[type] = rolesOf(type);
    }

    if (process.env.UPDATE_SNAPSHOT || !fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
    }

    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(actual, expected, 'roles changed — review and run with UPDATE_SNAPSHOT=1');
});
