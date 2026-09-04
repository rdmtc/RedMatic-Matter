const {trackBridge} = require('./lib/status');

module.exports = function (RED) {
    class RedMaticMatterPseudobutton {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.bridgeConfig = RED.nodes.getNode(config.bridgeConfig);
            if (!this.bridgeConfig || !this.bridgeConfig.bridge) {
                this.status({fill: 'red', shape: 'ring', text: 'no bridge'});
                return;
            }

            const {bridge} = this.bridgeConfig;
            this.name = config.name || 'Pseudobutton ' + this.id;
            this.payload = config.payload;
            this.payloadType = config.payloadType;
            this.resetDelay = 250;

            const device = bridge.device({
                ownerId: this.id,
                type: 'onOffPlugInUnit',
                label: this.name,
                productName: 'RedMatic Button',
            });
            this.device = device;

            const emit = () => {
                const msg = {topic: config.topic};
                if (this.payloadType === 'flow' || this.payloadType === 'global') {
                    RED.util.evaluateNodeProperty(this.payload, this.payloadType, this, msg, (err, res) => {
                        if (err) {
                            this.error(err, msg);
                        } else {
                            msg.payload = res;
                            this.send(msg);
                        }
                    });
                    return;
                }

                try {
                    if ((!this.payloadType && !this.payload) || this.payloadType === 'date') {
                        msg.payload = Date.now();
                    } else if (!this.payloadType) {
                        msg.payload = this.payload;
                    } else if (this.payloadType === 'none') {
                        msg.payload = '';
                    } else {
                        msg.payload = RED.util.evaluateNodeProperty(this.payload, this.payloadType, this, msg);
                    }

                    this.send(msg);
                } catch (error) {
                    this.error(error, msg);
                }
            };

            device.onChange('onOff', 'onOff', (value, meta) => {
                if (!meta.remote) {
                    return;
                }

                if (value) {
                    this.debug('pressed');
                    emit();
                    this.resetTimer = setTimeout(() => device.set({onOff: {onOff: false}}), this.resetDelay);
                }
            });

            const untrack = trackBridge(this, bridge);

            this.on('close', (removed, done) => {
                clearTimeout(this.resetTimer);
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

    RED.nodes.registerType('redmatic-matter-pseudobutton', RedMaticMatterPseudobutton);
};
