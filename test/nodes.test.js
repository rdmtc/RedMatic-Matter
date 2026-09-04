const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createFakeRED} = require('./helpers/fake-red');
const pairing = require('../nodes/lib/pairing');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

let port = Number(process.env.MATTER_TEST_PORT_BASE || 50000) + (process.pid % 300) * 40 + 20;
const nextPort = () => ++port;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const RED = createFakeRED();
for (const file of Object.values(pkg['node-red'].nodes)) {
    if (!file.includes('homematic')) {
        RED.load(path.join(root, file));
    }
}

const bridges = [];

/** a deployed bridge config node whose Matter node is started at once */
async function deployBridge(extra = {}) {
    const p = nextPort();
    const node = RED.instantiate('redmatic-matter-bridge', {
        id: 'bridge' + p,
        name: 'Test ' + p,
        bridgeId: 'test' + p,
        port: p,
        passcode: 20202021,
        discriminator: p % 4096,
        ...extra,
    });
    bridges.push(node);
    node.bridge.options.startDelay = 0;
    return node;
}

after(async () => {
    for (const node of bridges) {
        await RED.close(node, true);
    }

    RED.cleanup();
    if (process.env.MATTER_TEST_DEBUG) {
        setTimeout(() => console.log('active ' + JSON.stringify(process.getActiveResourcesInfo())), 1500).unref();
    }
});

test('every node set has a runtime and an editor file registering the same types', () => {
    const registered = (source) => [...source.matchAll(/registerType\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
    for (const [set, file] of Object.entries(pkg['node-red'].nodes)) {
        const js = path.join(root, file);
        const html = js.replace(/\.js$/, '.html');
        assert.ok(fs.existsSync(js), `${set}: ${file} missing`);
        assert.ok(fs.existsSync(html), `${set}: ${path.relative(root, html)} missing`);
        assert.equal(typeof require(js), 'function', `${set}: module must export function (RED)`);
        const jsTypes = registered(fs.readFileSync(js, 'utf8'));
        assert.ok(jsTypes.length > 0, `${set}: no registerType in ${file}`);
        assert.deepEqual(jsTypes, registered(fs.readFileSync(html, 'utf8')), `${set}: runtime and editor differ`);
    }
});

test('bridge node validates its settings and refuses invalid ones', () => {
    const bad = RED.instantiate('redmatic-matter-bridge', {
        id: 'bad',
        bridgeId: 'x',
        port: 5540,
        passcode: 12345678,
        discriminator: 1,
    });
    assert.equal(bad.bridge, undefined);
    assert.match(bad.logged.error[0][0], /passcode invalid/);
});

test('switch node: input drives the endpoint, controller writes reach the output', async () => {
    const bridgeNode = await deployBridge();
    const node = RED.instantiate('redmatic-matter-switch', {
        id: 'sw1',
        bridgeConfig: bridgeNode.id,
        name: 'Lampe',
        as: 'light',
    });
    await bridgeNode.bridge.start();
    assert.equal(bridgeNode.bridge.state, 'online');
    assert.equal(node.device.id, 'sw1~onOffLight');
    assert.equal(node.device.state.bridgedDeviceBasicInformation.nodeLabel, 'Lampe');

    node.receive({payload: true});
    await tick(20);
    assert.equal(node.device.state.onOff.onOff, true);
    assert.equal(node.sent.length, 0, 'own updates are not echoed');

    // a controller write arrives with a remote actor context
    node.device.listeners[0].fn(false, {remote: true, local: false});
    assert.deepEqual(node.sent[0], {payload: false, topic: ''});
    assert.match(node.statuses.at(-1).text, /pairing code \d{11}/);

    // redeploy keeps the endpoint, deletion removes it
    const number = node.device.number;
    await RED.close(node, false);
    assert.equal(bridgeNode.bridge.devices.size, 1);
    const again = RED.instantiate('redmatic-matter-switch', {
        id: 'sw1',
        bridgeConfig: bridgeNode.id,
        name: 'Lampe',
        as: 'light',
    });
    assert.equal(again.device.number, number);
    await RED.close(again, true);
    await bridgeNode.bridge.queue;
    assert.equal(bridgeNode.bridge.devices.size, 0);
});

test('pseudobutton emits its payload on a controller "on" and snaps back to off', async () => {
    const bridgeNode = await deployBridge();
    const node = RED.instantiate('redmatic-matter-pseudobutton', {
        id: 'pb1',
        bridgeConfig: bridgeNode.id,
        name: 'Szene',
        topic: 'scene',
        payload: '42',
        payloadType: 'num',
    });
    node.resetDelay = 20;
    await bridgeNode.bridge.start();
    await node.device.set({onOff: {onOff: true}});
    node.device.listeners[0].fn(true, {remote: true, local: false});
    assert.deepEqual(node.sent, [{topic: 'scene', payload: 42}]);
    await tick(60);
    assert.equal(node.device.state.onOff.onOff, false);
});

test('programmable switch creates one generic switch per button and performs presses', async () => {
    const bridgeNode = await deployBridge();
    const node = RED.instantiate('redmatic-matter-programmableswitch', {
        id: 'ps1',
        bridgeConfig: bridgeNode.id,
        name: 'Taster',
        count: 2,
    });
    await bridgeNode.bridge.start();
    assert.equal(node.devices.length, 2);
    assert.equal(node.devices[1].state.bridgedDeviceBasicInformation.nodeLabel, 'Taster 2');
    const events = [];
    for (const name of ['initialPress', 'shortRelease', 'longPress', 'longRelease', 'multiPressComplete']) {
        node.devices[0].endpoint.events.switch[name].on((payload) =>
            events.push(name + (payload.totalNumberOfPressesCounted ? payload.totalNumberOfPressesCounted : '')),
        );
    }

    node.receive({topic: '1/short'});
    await tick(700);
    assert.deepEqual(events.splice(0), ['initialPress', 'shortRelease', 'multiPressComplete1']);
    node.receive({topic: '1/double'});
    await tick(900);
    assert.deepEqual(events.splice(0), [
        'initialPress',
        'shortRelease',
        'initialPress',
        'shortRelease',
        'multiPressComplete2',
    ]);
    node.receive({topic: '1/long'});
    await tick(1600);
    assert.deepEqual(events.splice(0), ['initialPress', 'longPress', 'longRelease']);
    node.receive({topic: '3/short'});
    assert.match(node.logged.error.at(-1)[0], /invalid topic/);

    // a smaller count removes the extra endpoint
    await RED.close(node, false);
    RED.instantiate('redmatic-matter-programmableswitch', {
        id: 'ps1',
        bridgeConfig: bridgeNode.id,
        name: 'Taster',
        count: 1,
    });
    await bridgeNode.bridge.queue;
    assert.equal(bridgeNode.bridge.devicesOf('ps1/').length, 1);
});

test('universal node: topics set attributes, controller changes and commands are forwarded', async () => {
    const bridgeNode = await deployBridge();
    const node = RED.instantiate('redmatic-matter-universal', {
        id: 'un1',
        bridgeConfig: bridgeNode.id,
        name: 'Uni',
        endpoints: [
            {type: 'dimmableLight', name: 'Lampe'},
            {type: 'temperatureSensor', name: 'Klima', humidity: true},
            {type: 'doorLock', name: 'Tür'},
        ],
    });
    await bridgeNode.bridge.start();
    await tick(20);
    assert.equal(node.devices.size, 3);
    assert.equal(node.devices.get(1).id, 'un1_1~temperatureSensor+humidity');

    node.receive({topic: '0/onOff/onOff', payload: true});
    node.receive({topic: '0/levelControl', payload: {currentLevel: 100}});
    node.receive({topic: '1/temperatureMeasurement/measuredValue', payload: 2150});
    node.receive({topic: '1', payload: {relativeHumidityMeasurement: {measuredValue: 5000}}});
    await tick(50);
    assert.equal(node.devices.get(0).state.onOff.onOff, true);
    assert.equal(node.devices.get(0).state.levelControl.currentLevel, 100);
    assert.equal(node.devices.get(1).state.temperatureMeasurement.measuredValue, 2150);
    assert.equal(node.devices.get(1).state.relativeHumidityMeasurement.measuredValue, 5000);
    assert.equal(node.sent.length, 0);

    node.receive({topic: '9/onOff/onOff', payload: true});
    assert.match(node.logged.error.at(-1)[0], /unknown endpoint/);

    const level = node.devices
        .get(0)
        .listeners.find((l) => l.cluster === 'levelControl' && l.attribute === 'currentLevel');
    level.fn(200, {remote: true, local: false});
    assert.deepEqual(node.sent.at(-1), {topic: '0/levelControl/currentLevel', payload: 200});

    try {
        await node.devices.get(2).endpoint.act((agent) => agent.doorLock.lockDoor({}));
    } catch {}

    assert.deepEqual(node.sent.at(-1), {topic: '2/doorLock/lockDoor', payload: {}});

    // an endpoint removed from the list disappears from the bridge
    await RED.close(node, false);
    RED.instantiate('redmatic-matter-universal', {
        id: 'un1',
        bridgeConfig: bridgeNode.id,
        name: 'Uni',
        endpoints: [{type: 'dimmableLight', name: 'Lampe'}],
    });
    await bridgeNode.bridge.queue;
    assert.deepEqual(
        bridgeNode.bridge.devicesOf('un1/').map((d) => d.id),
        ['un1_0~dimmableLight'],
    );
});

test('admin endpoints: suggestions, live info, device types and actions', async () => {
    const suggest = await RED.get('/redmatic-matter/bridge', {suggest: '1'});
    assert.equal(suggest.status, 200);
    assert.ok(pairing.isValidBridgeId(suggest.body.bridgeId));
    assert.ok(pairing.isValidPasscode(suggest.body.passcode));
    assert.ok(pairing.isValidDiscriminator(suggest.body.discriminator));

    const missing = await RED.get('/redmatic-matter/bridge', {config: 'nope'});
    assert.equal(missing.status, 404);

    const bridgeNode = await deployBridge();
    RED.instantiate('redmatic-matter-switch', {id: 'swa', bridgeConfig: bridgeNode.id, name: 'A'});
    await bridgeNode.bridge.start();
    const info = await RED.get('/redmatic-matter/bridge', {config: bridgeNode.id});
    assert.equal(info.status, 200);
    assert.equal(info.body.online, true);
    assert.match(info.body.pairingCodes.qrPairingCode, /^MT:/);
    assert.equal(info.body.endpoints.length, 1);
    assert.deepEqual(info.body.fabrics, []);

    const types = await RED.get('/redmatic-matter/device-types');
    assert.ok(types.body.some((t) => t.name === 'extendedColorLight'));

    const window = await RED.post('/redmatic-matter/bridge/:id/:action', {
        id: bridgeNode.id,
        action: 'openCommissioningWindow',
    });
    assert.equal(window.status, 200);
    const remove = await RED.post(
        '/redmatic-matter/bridge/:id/:action',
        {id: bridgeNode.id, action: 'removeFabric'},
        {index: 1},
    );
    assert.equal(remove.status, 500);
    assert.match(remove.body.error, /no fabric/);
    const unknown = await RED.post('/redmatic-matter/bridge/:id/:action', {id: bridgeNode.id, action: 'explode'});
    assert.equal(unknown.status, 400);
    const reset = await RED.post('/redmatic-matter/bridge/:id/:action', {id: bridgeNode.id, action: 'factoryReset'});
    assert.equal(reset.status, 200);
    assert.equal(reset.body.online, true);
});

test('a redeploy with unchanged settings keeps the Matter node, a port change restarts it', async () => {
    const bridgeNode = await deployBridge();
    RED.instantiate('redmatic-matter-switch', {id: 'swb', bridgeConfig: bridgeNode.id, name: 'B'});
    await bridgeNode.bridge.start();
    const running = bridgeNode.bridge;
    await RED.close(bridgeNode, false);
    const same = RED.instantiate('redmatic-matter-bridge', {
        id: bridgeNode.id,
        name: running.options.name,
        bridgeId: running.id,
        port: running.options.port,
        passcode: 20202021,
        discriminator: running.options.discriminator,
    });
    assert.equal(same.bridge, running, 'same MatterBridge instance');
    assert.equal(same.bridge.state, 'online');
    await RED.close(same, false);
    const changed = RED.instantiate('redmatic-matter-bridge', {
        id: bridgeNode.id,
        name: running.options.name,
        bridgeId: running.id,
        port: nextPort(),
        passcode: 20202021,
        discriminator: running.options.discriminator,
    });
    bridges.push(changed);
    assert.notEqual(changed.bridge, running);
    await running.queue;
    assert.equal(running.state, 'stopped');
});
