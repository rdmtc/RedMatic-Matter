const devices = require('./lib/devices');
const {trackBridge} = require('./lib/status');

/** clusters a controller never writes to; not forwarded to the output */
const SILENT_CLUSTERS = new Set([
    'descriptor',
    'bridgedDeviceBasicInformation',
    'identify',
    'groups',
    'scenesManagement',
]);

module.exports = function (RED) {
    /** the device types the editor offers, without loading matter.js */
    RED.httpAdmin.get('/redmatic-matter/device-types', RED.auth.needsPermission('redmatic-matter.read'), (req, res) => {
        res.status(200).send(JSON.stringify(devices.list()));
    });

    class RedMaticMatterUniversal {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.bridgeConfig = RED.nodes.getNode(config.bridgeConfig);
            if (!this.bridgeConfig || !this.bridgeConfig.bridge) {
                this.status({fill: 'red', shape: 'ring', text: 'no bridge'});
                return;
            }

            const {bridge} = this.bridgeConfig;
            this.name = config.name || 'Universal ' + this.id;
            this.endpoints = (config.endpoints || []).map((e, index) => ({...e, index}));
            this.devices = new Map();

            for (const e of this.endpoints) {
                if (!devices.has(e.type)) {
                    this.error('unknown device type ' + e.type + ' (endpoint ' + e.index + ')');
                    continue;
                }

                const options = {};
                for (const flag of devices.OPTION_FLAGS) {
                    if (e[flag] === true || e[flag] === 'true') {
                        options[flag] = true;
                    }
                }

                const device = bridge.device({
                    ownerId: this.id + '/' + e.index,
                    type: e.type,
                    options,
                    label: e.name || this.name + ' ' + e.index,
                    productName: 'RedMatic Universal',
                    serialNumber: this.id + '/' + e.index,
                });
                this.devices.set(e.index, device);
                this.wire(e.index, device);
            }

            // endpoints removed from the list
            for (const stale of bridge.devicesOf(this.id + '/')) {
                const index = parseInt(String(stale.spec.ownerId).split('/')[1], 10);
                if (!this.devices.has(index) || this.devices.get(index) !== stale) {
                    this.debug('removing stale endpoint ' + stale.id);
                    bridge.removeDevice(stale.id, {erase: true});
                }
            }

            this.on('input', (msg) => this.input(msg));

            const untrack = trackBridge(this, bridge, () => this.devices.size + ' endpoints');

            this.on('close', (removed, done) => {
                untrack();
                for (const device of this.devices.values()) {
                    device.detach();
                }

                if (removed) {
                    Promise.all(
                        [...this.devices.values()].map((device) => bridge.removeDevice(device.id, {erase: true})),
                    ).then(() => done());
                } else {
                    done();
                }
            });
        }

        /** output every attribute change and command a controller causes */
        wire(index, device) {
            const attach = () => {
                for (const path of device.attributes()) {
                    const [cluster, attribute] = path.split('/');
                    if (
                        SILENT_CLUSTERS.has(cluster) ||
                        /^(featureMap|clusterRevision|attributeList|eventList|acceptedCommandList|generatedCommandList)$/.test(
                            attribute,
                        )
                    ) {
                        continue;
                    }

                    device.onChange(cluster, attribute, (value, meta) => {
                        if (meta.remote) {
                            this.send({topic: index + '/' + path, payload: value});
                        }
                    });
                }
            };

            if (device.endpoint) {
                attach();
            } else {
                device.once('ready', attach);
            }

            device.onCommand((command, request) => {
                this.send({topic: index + '/' + command, payload: request});
            });
        }

        input(msg) {
            const parts = String(msg.topic || '').split('/');
            const index = parseInt(parts[0], 10);
            const device = this.devices.get(index);
            if (!device) {
                this.error('unknown endpoint in topic ' + msg.topic);
                return;
            }

            if (typeof msg.reachable === 'boolean') {
                device.setReachable(msg.reachable);
            }

            let patch;
            if (parts.length >= 3) {
                patch = {[parts[1]]: {[parts[2]]: msg.payload}};
            } else if (parts.length === 2 && msg.payload && typeof msg.payload === 'object') {
                patch = {[parts[1]]: msg.payload};
            } else if (parts.length === 1 && msg.payload && typeof msg.payload === 'object') {
                patch = msg.payload;
            } else if (msg.payload === undefined) {
                return;
            } else {
                this.error(
                    'topic must be <endpoint>/<cluster>/<attribute> or <endpoint>/<cluster> with an object payload',
                );
                return;
            }

            this.debug('set ' + index + ' ' + JSON.stringify(patch));
            device.set(patch);
        }
    }

    RED.nodes.registerType('redmatic-matter-universal', RedMaticMatterUniversal);
};
