const {test} = require('node:test');
const assert = require('node:assert/strict');
const catalogue = require('../nodes/lib/catalogue');
const fixtures = require('./helpers/fixtures');
const {FakeCcu} = require('./helpers/fake-ccu');

test('describeDevices lists supported and unsupported devices with their endpoints', () => {
    const psm = fixtures.load('HmIP-PSM');
    const ho = fixtures.load('HmIP-MOD-HO');
    const devices = {};
    const names = {};
    const paramsets = {...psm.values, ...ho.values};
    for (const d of [...psm.device, ...ho.device]) {
        devices[d.ADDRESS] = d;
        names[d.ADDRESS] = d.PARENT ? d.TYPE + ' ' + d.INDEX : d.TYPE;
    }

    const ccu = new FakeCcu({iface: 'HmIP-RF', devices, channelNames: names, paramsets});
    const list = catalogue.describeDevices(ccu, {[psm.device[0].ADDRESS + ':3']: {type: 'Light'}});
    assert.deepEqual(
        list.map((d) => [d.type, d.supported]),
        [
            [ho.device[0].TYPE, true],
            [psm.device[0].TYPE, true],
        ],
    );
    assert.equal(list[0].channels.length, 1, 'only the switch channel of the garage module');
    const p = list[1];
    assert.deepEqual(p.options, []);
    assert.deepEqual(
        p.channels.map((c) => [c.address.split(':')[1], c.matterType, c.optIn]),
        [
            ['1', 'genericSwitch', true],
            ['3', 'onOffLight', false],
            ['4', 'onOffPlugInUnit', true],
            ['5', 'onOffPlugInUnit', true],
        ],
    );
    assert.deepEqual(p.channels[1].dropdowns, {type: ['Plug-in unit', 'Light']});
    assert.equal(p.unsupported[0].role, 'energy');
    assert.match(list[0].unsupported[0].reason, /RedMatic-HomeKit/);
});

test('devices of disabled interfaces and channels are skipped', () => {
    const ccu = fixtures.ccuFor('HmIP-SWDO');
    ccu.enabledIfaces = ['BidCos-RF'];
    assert.deepEqual(catalogue.describeDevices(ccu), []);
});
