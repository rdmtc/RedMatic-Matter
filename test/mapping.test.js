const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mapping = require('../nodes/lib/mapping');
const devices = require('../nodes/lib/devices');
const fixtures = require('./helpers/fixtures');

const {convert} = mapping;

function planOf(type, options = {}, channelModes = {}) {
    const ccu = fixtures.ccuFor(type);
    return mapping.plan(ccu.device, ccu, ccu.enabledIfaces[0], options, channelModes);
}

/** "<index>:<matter type>[+flags][*]" per endpoint */
function endpointsOf(type, options) {
    return planOf(type, options).endpoints.map(
        (e) =>
            `${e.index}:${devices.key(e.type, e.typeOptions)}${e.optIn ? '*' : ''}${e.role === 'boost' ? '(boost)' : ''}`,
    );
}

test('conversions', () => {
    assert.equal(convert.levelToMatter(0), 1);
    assert.equal(convert.levelToMatter(1), 254);
    assert.equal(convert.levelToHm(254), 1);
    assert.equal(convert.levelToHm(1), 0);
    assert.equal(convert.levelToHm(convert.levelToMatter(0.5)), 0.5);
    assert.equal(convert.positionToMatter(1), 0, 'open');
    assert.equal(convert.positionToMatter(0), 10000, 'closed');
    assert.equal(convert.positionToHm(2500), 0.75);
    assert.equal(convert.temperature(21.5), 2150);
    assert.equal(convert.temperature(null), null);
    assert.equal(convert.humidity(55), 5500);
    assert.equal(convert.illuminance(0), 0);
    assert.equal(convert.illuminance(1), 1);
    assert.equal(convert.illuminance(100), 20001);
    assert.equal(convert.hueToMatter(360), 254);
    assert.equal(convert.hueToHm(127), 180);
    assert.equal(convert.kelvinToMireds(2700), 370);
    assert.equal(convert.miredsToKelvin(370), 2703);
    assert.equal(convert.batteryPercent(3.0), 200, '2 cells full');
    assert.equal(convert.batteryPercent(2.5), 100);
    assert.equal(convert.batteryPercent(1.25), 100, '1 cell half');
    assert.equal(convert.batteryPercent(4.5), 200, '3 cells');
    assert.equal(convert.batteryPercent(0), null);
    assert.equal(convert.co2Quality(600), 1);
    assert.equal(convert.co2Quality(1500), 4);
});

test('well-known devices map to the expected Matter endpoints', () => {
    assert.deepEqual(endpointsOf('HmIP-PSM'), [
        '1:genericSwitch*',
        '3:onOffPlugInUnit',
        '4:onOffPlugInUnit*',
        '5:onOffPlugInUnit*',
    ]);
    assert.deepEqual(
        endpointsOf('HmIP-PSM', {[fixtures.load('HmIP-PSM').device[0].ADDRESS + ':3']: {type: 'Light'}}).slice(1, 2),
        ['3:onOffLight'],
    );
    assert.deepEqual(endpointsOf('HmIP-BROLL'), [
        '1:genericSwitch*',
        '2:genericSwitch*',
        '4:windowCovering',
        '5:windowCovering*',
        '6:windowCovering*',
    ]);
    assert.deepEqual(endpointsOf('HmIP-SWDO'), ['1:contactSensor+battery']);
    assert.deepEqual(endpointsOf('HmIP-SRH'), ['1:contactSensor+battery']);
    assert.deepEqual(endpointsOf('HmIP-SMI'), ['1:occupancySensor+battery+illuminance']);
    assert.deepEqual(endpointsOf('HmIP-SWSD'), ['1:smokeCoAlarm+battery']);
    assert.deepEqual(endpointsOf('HmIP-STHO'), ['1:temperatureSensor+battery+humidity']);
    assert.deepEqual(endpointsOf('HmIP-eTRV-2'), ['1:thermostat+battery']);
    assert.deepEqual(endpointsOf('HmIP-WTH-2'), ['1:thermostat+battery+humidity']);
    assert.deepEqual(endpointsOf('HmIP-DLD'), ['1:doorLock+battery']);
    assert.deepEqual(endpointsOf('HM-Sec-Key'), ['1:doorLock'], 'BidCos actuator: LOWBAT is not a battery');
    assert.deepEqual(endpointsOf('HmIP-WRC2'), ['1:genericSwitch+battery', '2:genericSwitch']);
    assert.deepEqual(endpointsOf('HM-LC-Sw4-DR'), [
        '1:onOffPlugInUnit',
        '2:onOffPlugInUnit',
        '3:onOffPlugInUnit',
        '4:onOffPlugInUnit',
    ]);
    assert.deepEqual(endpointsOf('HM-LC-Dim1T-FM'), ['1:dimmableLight']);
    assert.deepEqual(endpointsOf('HM-Sec-SC'), ['1:contactSensor+battery']);
    assert.deepEqual(endpointsOf('HmIP-SWD'), ['1:waterLeakDetector+battery']);
});

test('options: battery off, tilt off, boost on, humidity off', () => {
    const address = fixtures.load('HmIP-SWDO').device[0].ADDRESS;
    assert.deepEqual(endpointsOf('HmIP-SWDO', {[address + ':Battery']: {disabled: true}}), ['1:contactSensor']);

    const drbl = fixtures.load('HmIP-DRBLI4').device[0].ADDRESS;
    const p = planOf('HmIP-DRBLI4');
    const blind = p.endpoints.find((e) => e.role === 'blind_hmip' && !e.optIn);
    assert.equal(blind.typeOptions.tilt, true);
    assert.deepEqual(blind.dropdowns, {type: ['With tilt', 'Without tilt']});
    const noTilt = planOf('HmIP-DRBLI4', {[blind.address]: {type: 'Without tilt'}}).endpoints.find(
        (e) => e.address === blind.address,
    );
    assert.equal(noTilt.typeOptions.tilt, false);
    assert.ok(drbl);

    const wth = fixtures.load('HmIP-WTH-2').device[0].ADDRESS;
    assert.deepEqual(endpointsOf('HmIP-WTH-2', {[wth + ':Humidity']: {disabled: true}}), ['1:thermostat+battery']);
    assert.deepEqual(endpointsOf('HmIP-WTH-2', {[wth + ':Boost']: {enabled: true}}), [
        '1:thermostat+battery+humidity',
        '1:onOffPlugInUnit(boost)',
    ]);
    assert.deepEqual(planOf('HmIP-WTH-2').options, ['Battery', 'Humidity', 'Boost']);
});

test('garage doors and energy channels are listed as unsupported with a reason', () => {
    const p = planOf('HmIP-MOD-HO');
    assert.deepEqual(
        p.endpoints.map((e) => e.type),
        ['onOffPlugInUnit'],
        'the module’s switch channel maps, the garage door does not',
    );
    assert.equal(p.unsupported[0].role, 'garage');
    assert.match(p.unsupported[0].reason, /RedMatic-HomeKit/);
    const psm = planOf('HmIP-PSM');
    assert.equal(psm.unsupported.length, 1);
    assert.equal(psm.unsupported[0].role, 'energy');
});

test('HmIP actuators read their state from the transmitter and write to the receiver', () => {
    const p = planOf('HmIP-PSM');
    const a = p.address;
    const plug = p.endpoints.find((e) => e.index === 3);
    assert.equal(plug.subscriptions[0].datapoint, `HmIP-RF.${a}:2.STATE`);
    assert.deepEqual(plug.writes[0].handler(true), [{address: a + ':3', datapoint: 'STATE', value: true}]);
});

test('dimmer: level events, deferred bare on, level writes cancel the deferral', () => {
    const p = planOf('HmIP-PDT');
    const dimmer = p.endpoints.find((e) => e.role === 'dimmer' && !e.optIn);
    const memory = {};
    const api = {
        remember: (k, v) => (memory[k] = v),
        recall: (k) => memory[k],
        current: () => undefined,
        cancel: () => (memory.cancelled = true),
    };
    assert.deepEqual(dimmer.subscriptions[0].handler(0.5, {}, api), {
        onOff: {onOff: true},
        levelControl: {currentLevel: 128},
    });
    assert.deepEqual(dimmer.subscriptions[0].handler(0, {}, api), {onOff: {onOff: false}});
    const on = dimmer.writes.find((w) => w.attribute === 'onOff');
    assert.deepEqual(on.handler(false, {}, api), [{address: dimmer.address, datapoint: 'LEVEL', value: 0}]);
    assert.deepEqual(on.handler(true, {}, api), {
        defer: 'on',
        writes: [{address: dimmer.address, datapoint: 'LEVEL', value: 0.5}],
    });
    const level = dimmer.writes.find((w) => w.attribute === 'currentLevel');
    assert.deepEqual(level.handler(254, {state: {onOff: {onOff: true}}}, api), [
        {address: dimmer.address, datapoint: 'LEVEL', value: 1},
    ]);
    assert.equal(memory.cancelled, true);
    assert.equal(on.handler(true, {}, {...api, current: () => ({value: 0.7})}), null, 'already on: nothing to write');
});

test('window covering: positions are inverted, commands write LEVEL and STOP', () => {
    const p = planOf('HmIP-BROLL');
    const e = p.endpoints.find((e) => e.role === 'shutter_hmip' && !e.optIn);
    const a = e.address;
    assert.deepEqual(e.subscriptions[0].handler(0.25, {working: true}), {
        windowCovering: {currentPositionLiftPercent100ths: 7500},
    });
    assert.deepEqual(e.subscriptions[0].handler(0.25, {working: false}), {
        windowCovering: {currentPositionLiftPercent100ths: 7500, targetPositionLiftPercent100ths: 7500},
    });
    const cmd = (name) => e.commands.find((c) => c.command === name).handler;
    assert.deepEqual(cmd('windowCovering/upOrOpen')({}), [{address: a, datapoint: 'LEVEL', value: 1}]);
    assert.deepEqual(cmd('windowCovering/downOrClose')({}), [{address: a, datapoint: 'LEVEL', value: 0}]);
    assert.deepEqual(cmd('windowCovering/goToLiftPercentage')({liftPercent100thsValue: 3000}), [
        {address: a, datapoint: 'LEVEL', value: 0.7},
    ]);
    assert.deepEqual(cmd('windowCovering/stopMotion')({}), [{address: a, datapoint: 'STOP', value: true}]);
});

test('contacts: Matter true means closed, enums use the CLOSED index', () => {
    const swdo = planOf('HmIP-SWDO').endpoints[0];
    assert.deepEqual(swdo.subscriptions[0].handler(0), {booleanState: {stateValue: true}});
    assert.deepEqual(swdo.subscriptions[0].handler(1), {booleanState: {stateValue: false}});
    const sc = planOf('HM-Sec-SC').endpoints[0];
    assert.deepEqual(sc.subscriptions[0].handler(true), {booleanState: {stateValue: false}});
    assert.deepEqual(sc.subscriptions[0].handler(false), {booleanState: {stateValue: true}});
});

test('thermostat: 4.5 °C is off, setpoint writes are rounded to half degrees', () => {
    const e = planOf('HmIP-eTRV-2').endpoints[0];
    const memory = {};
    const api = {remember: (k, v) => (memory[k] = v), recall: (k) => memory[k], current: () => undefined, cancel() {}};
    const setpoint = e.subscriptions.find((s) => s.datapoint.endsWith('SET_POINT_TEMPERATURE'));
    assert.deepEqual(setpoint.handler(21, {}, api), {thermostat: {occupiedHeatingSetpoint: 2100, systemMode: 4}});
    assert.deepEqual(setpoint.handler(4.5, {}, api), {thermostat: {systemMode: 0}});
    const write = e.writes.find((w) => w.attribute === 'occupiedHeatingSetpoint');
    assert.deepEqual(write.handler(2270, {}, api), [
        {address: e.address, datapoint: 'SET_POINT_TEMPERATURE', value: 22.5},
    ]);
    const mode = e.writes.find((w) => w.attribute === 'systemMode');
    assert.deepEqual(mode.handler(0, {}, api), [{address: e.address, datapoint: 'SET_POINT_TEMPERATURE', value: 4.5}]);
    assert.deepEqual(
        mode.handler(4, {}, api),
        [{address: e.address, datapoint: 'SET_POINT_TEMPERATURE', value: 22.5}],
        'heat restores the last setpoint',
    );
});

test('locks: HmIP-DLD commands write LOCK_TARGET_LEVEL, OpenOnUnlock opens', () => {
    const p = planOf('HmIP-DLD');
    const e = p.endpoints[0];
    assert.deepEqual(e.subscriptions[0].handler(1), {doorLock: {lockState: 1}});
    assert.deepEqual(e.subscriptions[0].handler(2), {doorLock: {lockState: 2}});
    const cmd = (name) => e.commands.find((c) => c.command === name).handler({});
    assert.deepEqual(cmd('doorLock/lockDoor'), [{address: e.address, datapoint: 'LOCK_TARGET_LEVEL', value: 0}]);
    assert.deepEqual(
        cmd('doorLock/unlockDoor'),
        [{address: e.address, datapoint: 'LOCK_TARGET_LEVEL', value: 2}],
        'OPEN by default',
    );
    const closed = planOf('HmIP-DLD', {[p.address + ':OpenOnUnlock']: {disabled: true}}).endpoints[0];
    assert.deepEqual(closed.commands.find((c) => c.command === 'doorLock/unlockDoor').handler({}), [
        {address: e.address, datapoint: 'LOCK_TARGET_LEVEL', value: 1},
    ]);
});

test('keys: short/long datapoints, SWITCH_BEHAVIOR inputs have no long press', () => {
    const wrc = planOf('HmIP-WRC2');
    assert.equal(wrc.endpoints[0].keys.short, `HmIP-RF.${wrc.address}:1.PRESS_SHORT`);
    assert.equal(wrc.endpoints[0].keys.long, `HmIP-RF.${wrc.address}:1.PRESS_LONG`);
    assert.equal(wrc.endpoints[0].keys.release, `HmIP-RF.${wrc.address}:1.PRESS_LONG_RELEASE`);
    assert.deepEqual(wrc.endpoints[0].state, {switch: {longPressDelay: 300}});
    const dri = fixtures.load('HmIPW-DRI16').device[0].ADDRESS;
    const modes = {[dri + ':1']: 'SWITCH_BEHAVIOR', [dri + ':2']: 'BINARY_BEHAVIOR', [dri + ':3']: 'INACTIVE'};
    const p = planOf('HmIPW-DRI16', {}, modes);
    const one = p.endpoints.find((e) => e.address === dri + ':1');
    assert.equal(one.type, 'genericSwitch');
    assert.equal(one.keys.long, null);
    const two = p.endpoints.find((e) => e.address === dri + ':2');
    assert.equal(two.type, 'contactSensor');
    assert.equal(
        p.endpoints.some((e) => e.address === dri + ':3'),
        false,
    );
});

test('maintenance: battery and reachability subscriptions', () => {
    const p = planOf('HmIP-SWDO');
    const m = mapping.maintenancePlan(p);
    assert.deepEqual(
        m.subscriptions.map((s) => s.datapoint),
        [
            `HmIP-RF.${p.address}:0.LOW_BAT`,
            `HmIP-RF.${p.address}:0.OPERATING_VOLTAGE`,
            `HmIP-RF.${p.address}:0.UNREACH`,
        ],
    );
    assert.deepEqual(m.subscriptions[0].handler(true), {powerSource: {batChargeLevel: 2, batReplacementNeeded: true}});
    assert.deepEqual(m.subscriptions[1].handler(2.9), {powerSource: {batPercentRemaining: 180}});
    assert.deepEqual(m.subscriptions[2].handler(true), {reachable: false});
    // BidCos mains actuators report LOWBAT too: no battery there
    assert.equal(planOf('HM-LC-Sw4-DR').batteryPossible, false);
    assert.equal(planOf('HM-Sec-SC').batteryPossible, true);
});

test('every device type named by a plan exists in the device catalogue', () => {
    for (const type of fixtures.types()) {
        const p = planOf(type);
        for (const e of p.endpoints) {
            assert.ok(devices.has(e.type), `${type}: unknown device type ${e.type}`);
        }
    }
});

test('mapping snapshot over the whole fixture set', () => {
    const file = path.join(__dirname, 'fixtures', 'mapping.snapshot.json');
    const actual = {};
    for (const type of fixtures.types()) {
        const p = planOf(type);
        actual[type] = {
            endpoints: endpointsOf(type),
            options: p.options,
            unsupported: p.unsupported.map((u) => `${u.address.split(':')[1]}:${u.role}`),
        };
    }

    if (process.env.UPDATE_SNAPSHOT || !fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
    }

    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(actual, expected, 'mapping changed — review and run with UPDATE_SNAPSHOT=1');
});
