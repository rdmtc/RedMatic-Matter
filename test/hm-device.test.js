/* The bridge loop against real ServerNodes: CCU events reach the endpoints,
   controller writes and commands reach the CCU with the field rules
   (deferred bare on, echo suppression, one long press per PRESS_LONG
   stream, battery and reachability). */

const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/matter-harness');
const fixtures = require('./helpers/fixtures');
const mapping = require('../nodes/lib/mapping');
const {HomematicDevice} = require('../nodes/lib/hm-device');

const {createBridge, stopAll, tick} = harness;

after(async () => {
    await stopAll();
    harness.cleanup();
});

/** a bridge with one Homematic device (all channels enabled) */
async function setup(type, {options = {}, values = {}, timing = {}, channelNames} = {}) {
    const ccu = fixtures.ccuFor(type, {channelNames, values});
    const address = ccu.address;
    const config = {[address]: {enabled: true}, ...options};
    const p = mapping.plan(ccu.device, ccu, ccu.enabledIfaces[0], config);
    const bridge = createBridge();
    const logs = [];
    const hm = new HomematicDevice(p, {
        ccu,
        bridge,
        log: (level, m) => logs.push(level + ' ' + m),
        // generous margins for slow CI runners; the PDT test checks the deferral window against deferOn
        timing: {deferOn: 300, longPressGap: 600, ...timing},
    });
    hm.start();
    await bridge.start();
    await tick(150);
    return {
        ccu,
        bridge,
        hm,
        plan: p,
        address,
        logs,
        device: (index) => hm.devices.find((d) => d.spec.ownerId === address + ':' + index),
    };
}

/** simulate a controller write: run the change listener with a remote context */
function remoteWrite(device, cluster, attribute, value) {
    const entry = device.listeners.find((l) => l.cluster === cluster && l.attribute === attribute);
    assert.ok(entry, 'listener ' + cluster + '/' + attribute);
    entry.fn(value, {remote: true, local: false, old: undefined, context: {}});
}

test('HmIP-PSM: transmitter state feeds the plug, controller writes go to the receiver', async () => {
    const s = await setup('HmIP-PSM');
    const plug = s.device(3);
    assert.equal(plug.typeKey, 'onOffPlugInUnit');
    assert.equal(s.hm.devices.length, 1, 'keys on actuators and virtual receivers are opt-in');
    assert.equal(plug.state.bridgedDeviceBasicInformation.nodeLabel, s.ccu.device.TYPE);
    assert.equal(plug.state.bridgedDeviceBasicInformation.productName, s.ccu.device.TYPE);

    s.ccu.emitValue(`HmIP-RF.${s.address}:2.STATE`, true);
    await tick(150);
    assert.equal(plug.state.onOff.onOff, true);
    assert.equal(s.ccu.setCalls.length, 0, 'CCU events never write back');

    remoteWrite(plug, 'onOff', 'onOff', false);
    await tick(150);
    assert.deepEqual(s.ccu.setCalls, [
        {iface: 'HmIP-RF', channel: s.address + ':3', datapoint: 'STATE', value: false, burst: false, force: false},
    ]);

    s.ccu.emitValue(`HmIP-RF.${s.address}:0.UNREACH`, true);
    await tick(150);
    assert.equal(plug.state.bridgedDeviceBasicInformation.reachable, false);
});

test('HmIP-PDT: a bare on is deferred and cancelled by a level write; off is immediate', async () => {
    const s = await setup('HmIP-PDT');
    const dimmer = s.hm.devices.find((d) => d.typeKey === 'dimmableLight');
    assert.ok(dimmer);
    // the PDT's transmitter is channel 2, its receivers 3..5 (real fixture)
    const levelDp = `HmIP-RF.${s.address}:2.LEVEL`;
    assert.ok(
        s.ccu.subscriptions.some((x) => x.filter.datapointName === levelDp),
        'state is read from the transmitter',
    );
    s.ccu.emitValue(levelDp, 0.4);
    await tick(150);
    assert.equal(dimmer.state.onOff.onOff, true);
    assert.equal(dimmer.state.levelControl.currentLevel, 102);
    s.ccu.emitValue(levelDp, 0);
    await tick(150);
    assert.equal(dimmer.state.onOff.onOff, false);

    // on + level within the window: one LEVEL write
    remoteWrite(dimmer, 'onOff', 'onOff', true);
    remoteWrite(dimmer, 'levelControl', 'currentLevel', 254);
    await tick(500);
    assert.deepEqual(
        s.ccu.setCalls.map((c) => [c.channel, c.datapoint, c.value]),
        [[s.address + ':3', 'LEVEL', 1]],
        'written to the first virtual receiver',
    );

    // bare on: the last level is restored after the window
    s.ccu.setCalls.length = 0;
    remoteWrite(dimmer, 'onOff', 'onOff', true);
    await tick(50);
    assert.equal(s.ccu.setCalls.length, 0, 'not yet');
    await tick(500);
    assert.deepEqual(
        s.ccu.setCalls.map((c) => [c.datapoint, c.value]),
        [['LEVEL', 1]],
    );

    // off is immediate
    s.ccu.setCalls.length = 0;
    remoteWrite(dimmer, 'onOff', 'onOff', false);
    await tick(20);
    assert.deepEqual(
        s.ccu.setCalls.map((c) => [c.datapoint, c.value]),
        [['LEVEL', 0]],
    );
});

test('HmIP-BROLL: positions are mirrored, stop and go-to commands reach the CCU', async () => {
    const s = await setup('HmIP-BROLL');
    const cover = s.hm.devices.find((d) => d.typeKey === 'windowCovering');
    s.ccu.emitValue(`HmIP-RF.${s.address}:3.LEVEL`, 0.2);
    await tick(150);
    assert.equal(cover.state.windowCovering.currentPositionLiftPercent100ths, 8000);

    await cover.endpoint.act((agent) => agent.windowCovering.goToLiftPercentage({liftPercent100thsValue: 5000}));
    await cover.endpoint.act((agent) => agent.windowCovering.stopMotion());
    await tick(150);
    assert.deepEqual(
        s.ccu.setCalls.map((c) => [c.channel, c.datapoint, c.value]),
        [
            [s.address + ':4', 'LEVEL', 0.5],
            [s.address + ':4', 'STOP', true],
        ],
    );
});

test('HmIP-SWDO: contact with battery and voltage', async () => {
    const s = await setup('HmIP-SWDO', {channelNames: {}});
    const contact = s.hm.devices[0];
    assert.equal(contact.typeKey, 'contactSensor+battery');
    s.ccu.emitValue(`HmIP-RF.${s.address}:1.STATE`, 1);
    s.ccu.emitValue(`HmIP-RF.${s.address}:0.LOW_BAT`, false);
    s.ccu.emitValue(`HmIP-RF.${s.address}:0.OPERATING_VOLTAGE`, 1.4);
    await tick(150);
    assert.equal(contact.state.booleanState.stateValue, false, 'open');
    assert.equal(contact.state.powerSource.batChargeLevel, 0);
    assert.equal(contact.state.powerSource.batPercentRemaining, 160);
    s.ccu.emitValue(`HmIP-RF.${s.address}:0.LOW_BAT`, true);
    await tick(150);
    assert.equal(contact.state.powerSource.batChargeLevel, 2);
});

test('HmIP-WRC2: a PRESS_LONG stream is one long press, PRESS_SHORT a short press, usage is reported', async () => {
    const s = await setup('HmIP-WRC2', {timing: {pressTime: 20}});
    assert.equal(s.hm.devices.length, 2);
    const button = s.device(1);
    const events = [];
    for (const name of ['initialPress', 'shortRelease', 'longPress', 'longRelease', 'multiPressComplete']) {
        button.endpoint.events.switch[name].on(() => events.push(name));
    }

    const fire = (dp) => {
        for (const sub of s.ccu.subscriptions.filter((x) => x.filter.datapointName === dp)) {
            sub.callback({datapointName: dp, value: true});
        }
    };

    fire(`HmIP-RF.${s.address}:1.PRESS_SHORT`);
    await tick(1200);
    assert.deepEqual(events.splice(0), ['initialPress', 'shortRelease', 'multiPressComplete']);

    // a held key: PRESS_LONG every ~200 ms, then PRESS_LONG_RELEASE (longPressDelay of the endpoint is 300 ms)
    fire(`HmIP-RF.${s.address}:1.PRESS_LONG`);
    await tick(200);
    fire(`HmIP-RF.${s.address}:1.PRESS_LONG`);
    await tick(200);
    fire(`HmIP-RF.${s.address}:1.PRESS_LONG`);
    await tick(400);
    fire(`HmIP-RF.${s.address}:1.PRESS_LONG_RELEASE`);
    await tick(400);
    assert.deepEqual(events.splice(0), ['initialPress', 'longPress', 'longRelease']);

    const usage = s.ccu.setCalls.filter((c) => c.method === 'reportValueUsage').map((c) => c.params.join(' '));
    assert.deepEqual(usage, [
        `${s.address}:1 PRESS_SHORT 1`,
        `${s.address}:1 PRESS_LONG 1`,
        `${s.address}:2 PRESS_SHORT 1`,
        `${s.address}:2 PRESS_LONG 1`,
    ]);
});

test('HmIP-eTRV-2: thermostat with battery, setpoint writes', async () => {
    const s = await setup('HmIP-eTRV-2');
    const thermostat = s.hm.devices[0];
    s.ccu.emitValue(`HmIP-RF.${s.address}:1.ACTUAL_TEMPERATURE`, 20.3);
    s.ccu.emitValue(`HmIP-RF.${s.address}:1.SET_POINT_TEMPERATURE`, 22);
    await tick(150);
    assert.equal(thermostat.state.thermostat.localTemperature, 2030);
    assert.equal(thermostat.state.thermostat.occupiedHeatingSetpoint, 2200);
    assert.equal(thermostat.state.thermostat.systemMode, 4);
    remoteWrite(thermostat, 'thermostat', 'occupiedHeatingSetpoint', 1950);
    remoteWrite(thermostat, 'thermostat', 'systemMode', 0);
    await tick(150);
    assert.deepEqual(
        s.ccu.setCalls.map((c) => [c.datapoint, c.value]),
        [
            ['SET_POINT_TEMPERATURE', 19.5],
            ['SET_POINT_TEMPERATURE', 4.5],
        ],
    );
});

test('stop() unsubscribes and detaches, remove() deletes the endpoints', async () => {
    const s = await setup('HmIP-SWDO');
    assert.ok(s.ccu.subscriptions.length > 0);
    s.hm.stop();
    assert.equal(s.ccu.subscriptions.length, 0);
    assert.equal(s.bridge.devices.size, 1, 'endpoint stays for a redeploy');
    await s.hm.remove({erase: true});
    assert.equal(s.bridge.devices.size, 0);
});
