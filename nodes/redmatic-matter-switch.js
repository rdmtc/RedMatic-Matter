const {trackBridge} = require('./lib/status');

module.exports = function (RED) {
    class RedMaticMatterSwitch {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.bridgeConfig = RED.nodes.getNode(config.bridgeConfig);
            if (!this.bridgeConfig || !this.bridgeConfig.bridge) {
                this.status({fill: 'red', shape: 'ring', text: 'no bridge'});
                return;
            }

            const {bridge} = this.bridgeConfig;
            this.name = config.name || 'Switch ' + this.id;
            const type = config.as === 'light' ? 'onOffLight' : 'onOffPlugInUnit';

            const device = bridge.device({
                ownerId: this.id,
                type,
                label: this.name,
                productName: 'RedMatic Switch',
            });
            this.device = device;

            device.onChange('onOff', 'onOff', (value, meta) => {
                // only what a controller wrote is forwarded; our own set() is local
                if (meta.remote) {
                    this.debug('controller set onOff ' + value);
                    this.send({payload: value, topic: config.topic || ''});
                }
            });

            this.on('input', (msg) => {
                device.set({onOff: {onOff: Boolean(msg.payload)}});
                if (typeof msg.reachable === 'boolean') {
                    device.setReachable(msg.reachable);
                }
            });

            const untrack = trackBridge(this, bridge, () => (device.state.onOff.onOff ? 'on' : 'off'));
            device.onChange('onOff', 'onOff', () => untrack.update());

            this.on('close', (removed, done) => {
                untrack();
                device.detach();
                if (removed) {
                    bridge.removeDevice(device.id, {erase: true}).then(() => done());
                } else {
                    done();
                }
            });
        }
    }

    RED.nodes.registerType('redmatic-matter-switch', RedMaticMatterSwitch);
};
