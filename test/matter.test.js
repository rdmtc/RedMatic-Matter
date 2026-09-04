const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./helpers/matter-harness');
const devices = require('../nodes/lib/devices');

const {createBridge, stopAll, tick} = harness;

after(async () => {
    await stopAll();
    harness.cleanup();
});

test('a bridge with two endpoints goes online, numbers its endpoints and has pairing codes', async () => {
    const bridge = createBridge();
    const plug = bridge.device({
        ownerId: 'ABC0000001:3',
        type: 'onOffPlugInUnit',
        label: 'Steckdose',
        productName: 'HmIP-PS',
    });
    const contact = bridge.device({
        ownerId: 'ABC0000002:1',
        type: 'contactSensor',
        options: {battery: true},
        label: 'Fenster',
    });
    await bridge.start();

    assert.equal(bridge.state, 'online');
    assert.equal(bridge.online, true);
    assert.equal(bridge.commissioned, false);
    assert.match(bridge.pairingCodes.manualPairingCode, /^\d{11}$/);
    assert.match(bridge.pairingCodes.qrPairingCode, /^MT:/);
    assert.equal(plug.number, 2, 'aggregator is 1, first bridged endpoint is 2');
    assert.equal(contact.number, 3);
    assert.equal(plug.id, 'ABC0000001:3~onOffPlugInUnit');
    assert.equal(contact.id, 'ABC0000002:1~contactSensor+battery');
    assert.equal(plug.state.bridgedDeviceBasicInformation.nodeLabel, 'Steckdose');
    assert.equal(plug.state.bridgedDeviceBasicInformation.productName, 'HmIP-PS');
    assert.equal(plug.state.bridgedDeviceBasicInformation.serialNumber, 'ABC0000001:3');
    assert.equal(contact.state.powerSource.batChargeLevel, 0);

    const info = bridge.info();
    assert.equal(info.endpoints.length, 2);
    assert.deepEqual(info.fabrics, []);
    assert.equal(info.online, true);
    assert.ok(fs.existsSync(path.join(harness.storageRoot, bridge.id)));
});

test('state patches before and after start, change events mark our own writes as local', async () => {
    const bridge = createBridge();
    const plug = bridge.device({ownerId: 'n1', type: 'onOffPlugInUnit', label: 'Plug'});
    const seen = [];
    plug.onChange('onOff', 'onOff', (value, meta) => seen.push([value, meta.local, meta.remote]));
    await plug.set({onOff: {onOff: true}});
    assert.equal(plug.state.onOff.onOff, true, 'pending state before start');
    await bridge.start();
    assert.equal(plug.state.onOff.onOff, true, 'initial state after start');
    await plug.set({onOff: {onOff: false}});
    await tick();
    assert.deepEqual(seen, [[false, true, false]]);
    await plug.setReachable(false);
    assert.equal(plug.state.bridgedDeviceBasicInformation.reachable, false);
    await plug.setLabel('A very long name that exceeds the thirty-two character limit');
    assert.equal(plug.state.bridgedDeviceBasicInformation.nodeLabel.length, 32);
    assert.ok(plug.attributes().includes('onOff/onOff'));
});

test('command hooks: door lock and window covering commands reach the handler', async () => {
    const bridge = createBridge();
    const lock = bridge.device({ownerId: 'lock1', type: 'doorLock', label: 'Tür'});
    const cover = bridge.device({ownerId: 'cover1', type: 'windowCovering', options: {tilt: true}, label: 'Jalousie'});
    const commands = [];
    lock.onCommand((command, request) => commands.push([command, request]));
    cover.onCommand((command, request) => commands.push([command, request]));
    await bridge.start();

    // matter.js' lock implementation logs an event that needs a fabric; a
    // controller always has one, the local test actor does not — the hook
    // runs before that and is what we verify here
    try {
        await lock.endpoint.act((agent) => agent.doorLock.unlockDoor({}));
    } catch {}
    await cover.endpoint.act((agent) => agent.windowCovering.goToLiftPercentage({liftPercent100thsValue: 5000}));
    await cover.endpoint.act((agent) => agent.windowCovering.stopMotion());
    await cover.endpoint.act((agent) => agent.windowCovering.upOrOpen());
    assert.deepEqual(
        commands.map(([c]) => c),
        [
            'doorLock/unlockDoor',
            'windowCovering/goToLiftPercentage',
            'windowCovering/stopMotion',
            'windowCovering/upOrOpen',
        ],
    );
    assert.equal(commands[1][1].liftPercent100thsValue, 5000);
    // the default movement is disabled: the position stays until the device reports it
    assert.equal(cover.state.windowCovering.currentPositionLiftPercent100ths, 0);
    await cover.set({windowCovering: {currentPositionLiftPercent100ths: 5000, targetPositionLiftPercent100ths: 5000}});
    assert.equal(cover.state.windowCovering.currentPositionLiftPercent100ths, 5000);
});

test('generic switch press sequence emits initialPress, shortRelease and multiPressComplete', async () => {
    const bridge = createBridge();
    const button = bridge.device({ownerId: 'btn1', type: 'genericSwitch', label: 'Taster'});
    await bridge.start();
    const events = [];
    for (const name of ['initialPress', 'shortRelease', 'longPress', 'longRelease', 'multiPressComplete']) {
        button.endpoint.events.switch[name].on(() => events.push(name));
    }

    await button.set({switch: {currentPosition: 1}});
    await button.set({switch: {currentPosition: 0}});
    await tick(700);
    assert.deepEqual(events, ['initialPress', 'shortRelease', 'multiPressComplete']);
});

test('endpoint numbers survive a restart from the same storage; deleted endpoints are gone', async () => {
    const port = harness.nextPort();
    const first = createBridge({port, id: 'persist-' + port});
    const a = first.device({ownerId: 'dev-a', type: 'onOffLight', label: 'A'});
    const b = first.device({ownerId: 'dev-b', type: 'onOffLight', label: 'B'});
    await first.start();
    const numberA = a.number;
    const numberB = b.number;
    assert.ok(numberA > 1 && numberB > numberA);
    await first.removeDevice(b.id, {erase: false});
    await first.stop();

    const second = createBridge({port, id: 'persist-' + port});
    const c = second.device({ownerId: 'dev-c', type: 'onOffLight', label: 'C'});
    const a2 = second.device({ownerId: 'dev-a', type: 'onOffLight', label: 'A'});
    const b2 = second.device({ownerId: 'dev-b', type: 'onOffLight', label: 'B'});
    await second.start();
    assert.equal(a2.number, numberA, 'same id, same number');
    assert.equal(b2.number, numberB, 'closed (not erased) endpoint keeps its number');
    assert.ok(c.number > numberB, 'new endpoint gets a fresh number');
    await second.stop();
});

test('a changed device type rotates the endpoint identity of the same owner', async () => {
    const bridge = createBridge();
    const light = bridge.device({ownerId: 'sw1', type: 'onOffLight', label: 'Licht'});
    await bridge.start();
    assert.equal(bridge.devices.size, 1);
    const plug = bridge.device({ownerId: 'sw1', type: 'onOffPlugInUnit', label: 'Licht'});
    await bridge.queue;
    assert.equal(bridge.devices.size, 1);
    assert.notEqual(plug.id, light.id);
    assert.equal(light.endpoint, null, 'old endpoint removed');
    assert.ok(plug.number > light.number || plug.number !== undefined);
    assert.equal(bridge.devicesOf('sw1').length, 1);
});

test('re-requesting a device with the same spec reuses the endpoint and replaces listeners', async () => {
    const bridge = createBridge();
    const one = bridge.device({ownerId: 'u1', type: 'temperatureSensor', label: 'Temp'});
    let firstCalls = 0;
    one.onChange('temperatureMeasurement', 'measuredValue', () => firstCalls++);
    await bridge.start();
    const again = bridge.device({ownerId: 'u1', type: 'temperatureSensor', label: 'Temp neu'});
    assert.equal(again, one, 'same Device object');
    let secondCalls = 0;
    again.onChange('temperatureMeasurement', 'measuredValue', () => secondCalls++);
    await again.set({temperatureMeasurement: {measuredValue: 2150}});
    await tick();
    assert.equal(firstCalls, 0, 'old listener detached');
    assert.equal(secondCalls, 1);
    assert.equal(again.state.bridgedDeviceBasicInformation.nodeLabel, 'Temp neu');
});

test('holds delay the start until released', async () => {
    const bridge = createBridge({startDelay: 10, startTimeout: 10000});
    const release = bridge.hold('homematic');
    bridge.device({ownerId: 'h1', type: 'onOffLight', label: 'L'});
    await tick(100);
    assert.equal(bridge.state, 'idle');
    release();
    await tick(50);
    await bridge.queue;
    assert.equal(bridge.state, 'online');
});

test('two bridges run side by side in one process on different ports', async () => {
    const one = createBridge();
    const two = createBridge();
    one.device({ownerId: 'x', type: 'onOffLight', label: 'One'});
    two.device({ownerId: 'x', type: 'onOffLight', label: 'Two'});
    await one.start();
    await two.start();
    assert.equal(one.state, 'online');
    assert.equal(two.state, 'online');
    assert.notEqual(one.options.port, two.options.port);
});

test('a port in use is reported instead of crashing', async () => {
    const one = createBridge();
    one.device({ownerId: 'p', type: 'onOffLight', label: 'One'});
    await one.start();
    const two = createBridge({port: one.options.port});
    two.device({ownerId: 'p', type: 'onOffLight', label: 'Two'});
    const errors = [];
    two.on('error', (error) => errors.push(error.message));
    await two.start();
    assert.equal(two.state, 'error');
    assert.match(two.error, /port \d+ is in use/);
    assert.equal(errors.length, 1);
});

test('factory reset erases the storage and restarts the bridge with its endpoints', async () => {
    const bridge = createBridge();
    const plug = bridge.device({ownerId: 'fr', type: 'onOffPlugInUnit', label: 'Plug'});
    await bridge.start();
    await plug.set({onOff: {onOff: true}});
    const number = plug.number;
    await bridge.factoryReset();
    assert.equal(bridge.state, 'online');
    assert.equal(bridge.server.lifecycle.isOnline, true);
    assert.equal(bridge.commissioned, false);
    assert.equal(plug.number, number, 'numbering starts over at the same value');
    assert.match(bridge.pairingCodes.manualPairingCode, /^\d{11}$/);
    assert.equal(plug.state.onOff.onOff, true, 'the endpoint was re-created from its pending state');
    await plug.set({onOff: {onOff: false}});
    assert.equal(plug.state.onOff.onOff, false, 'endpoint usable after the reset');
    await bridge.stop();
    assert.equal(bridge.state, 'stopped');
});

test('every device type and option combination initialises on a real ServerNode', async () => {
    const bridge = createBridge();
    const combos = [];
    for (const {name} of devices.list()) {
        combos.push([name, {}]);
        combos.push([name, {battery: true}]);
        if (name === 'windowCovering') {
            combos.push([name, {tilt: true}]);
        }

        if (name === 'temperatureSensor' || name === 'thermostat') {
            combos.push([name, {humidity: true}]);
        }

        if (name === 'occupancySensor') {
            combos.push([name, {illuminance: true}]);
        }
    }

    const handles = combos.map(([type, options], i) =>
        bridge.device({ownerId: 'combo' + i, type, options, label: type}),
    );
    const failures = [];
    for (const handle of handles) {
        handle.on('error', (error) => failures.push(handle.id + ': ' + harness.matter.describeError(error)));
    }

    await bridge.start();
    assert.deepEqual(failures, []);
    assert.equal(bridge.devices.size, combos.length);
    for (const handle of handles) {
        assert.ok(handle.number > 1, handle.id + ' has a number');
    }
});
