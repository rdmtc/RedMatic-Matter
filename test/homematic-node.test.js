/* The homematic node's view of the ccu-connection: it publishes once every
   enabled interface is connected, also when the connection reports extra
   pseudo-interfaces (openccu-lite's Metadata stream). */

const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {createFakeRED} = require('./helpers/fake-red');
const {FakeCcu} = require('./helpers/fake-ccu');
const {ccuConnection} = require('../nodes/lib/status');

const RED = createFakeRED();
RED.load(path.join(__dirname, '..', 'nodes', 'redmatic-matter-bridge.js'));
RED.load(path.join(__dirname, '..', 'nodes', 'redmatic-matter-homematic-devices.js'));

const port = Number(process.env.MATTER_TEST_PORT_BASE || 50000) + (process.pid % 300) * 40 + 35;
const ccu = new FakeCcu({iface: 'BidCos-RF'});
ccu.enabledIfaces = ['BidCos-RF', 'HmIP-RF', 'VirtualDevices'];
const getNode = RED.nodes.getNode;
RED.nodes.getNode = (id) => (id === 'ccu1' ? ccu : getNode(id));

const bridgeNode = RED.instantiate('redmatic-matter-bridge', {
    id: 'hmbridge',
    name: 'HM test',
    bridgeId: 'hmtest' + port,
    port,
    passcode: 20202021,
    discriminator: port % 4096,
});

after(async () => {
    await RED.close(bridgeNode, true);
    RED.cleanup();
});

test('ccuConnection judges the enabled interfaces only', () => {
    const enabled = ['BidCos-RF', 'HmIP-RF', 'VirtualDevices'];
    const all = {'BidCos-RF': true, 'HmIP-RF': true, VirtualDevices: true};
    assert.equal(ccuConnection(enabled, all), 'connected');
    assert.equal(ccuConnection(enabled, {...all, Metadata: true}), 'connected', 'Metadata is not an interface');
    assert.equal(ccuConnection(enabled, {...all, VirtualDevices: false, Metadata: true}), 'partly');
    assert.equal(ccuConnection(enabled, {Metadata: true}), 'disconnected');
    assert.equal(ccuConnection(enabled, {}), 'disconnected');
});

test('the node publishes when all interfaces and the Metadata stream are connected', async () => {
    const node = RED.instantiate('redmatic-matter-homematic-devices', {
        id: 'hm1',
        ccuConfig: 'ccu1',
        bridgeConfig: 'hmbridge',
        devices: {},
    });
    let published = 0;
    node.publishWhenReady = () => published++;
    node.setStatus({
        ifaceStatus: {'BidCos-RF': true, 'HmIP-RF': true, VirtualDevices: true, Metadata: true},
        ifaceWaiting: {},
        ifaceError: {},
    });
    assert.equal(node.detail, 'ccu connected');
    assert.equal(published, 1);
    await RED.close(node, true);
});
