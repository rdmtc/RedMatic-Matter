const {trackBridge} = require('./lib/status');
const {press, kindOf} = require('./lib/press');

module.exports = function (RED) {
    class RedMaticMatterProgrammableSwitch {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.bridgeConfig = RED.nodes.getNode(config.bridgeConfig);
            if (!this.bridgeConfig || !this.bridgeConfig.bridge) {
                this.status({fill: 'red', shape: 'ring', text: 'no bridge'});
                return;
            }

            const {bridge} = this.bridgeConfig;
            this.name = config.name || 'Buttons ' + this.id;
            this.count = Math.max(1, Math.min(50, parseInt(config.count, 10) || 1));
            this.timing = {};

            // one GenericSwitch endpoint per button, owner id <node id>/<button>
            this.devices = [];
            for (let index = 1; index <= this.count; index++) {
                this.devices.push(
                    bridge.device({
                        ownerId: this.id + '/' + index,
                        type: 'genericSwitch',
                        label: this.count === 1 ? this.name : this.name + ' ' + index,
                        productName: 'RedMatic Button',
                        serialNumber: this.id + '/' + index,
                    }),
                );
            }

            // buttons removed by a smaller count
            for (const stale of bridge.devicesOf(this.id + '/')) {
                const index = parseInt(String(stale.spec.ownerId).split('/')[1], 10);
                if (index > this.count) {
                    bridge.removeDevice(stale.id, {erase: true});
                }
            }

            this.on('input', (msg) => {
                const [button, kind] = String(msg.topic).split('/');
                const index = parseInt(button, 10);
                if (!(index >= 1 && index <= this.count)) {
                    this.error('invalid topic ' + msg.topic + ' (expected <button>/<short|long|double>)');
                    return;
                }

                const device = this.devices[index - 1];
                this.debug('press ' + index + ' ' + kindOf(kind));
                press(device, kindOf(kind), this.timing).catch((error) => this.error('press failed: ' + error.message));
            });

            const untrack = trackBridge(this, bridge);

            this.on('close', (removed, done) => {
                untrack();
                for (const device of this.devices) {
                    device.detach();
                }

                if (removed) {
                    Promise.all(this.devices.map((device) => bridge.removeDevice(device.id, {erase: true}))).then(() =>
                        done(),
                    );
                } else {
                    done();
                }
            });
        }
    }

    RED.nodes.registerType('redmatic-matter-programmableswitch', RedMaticMatterProgrammableSwitch);
};
