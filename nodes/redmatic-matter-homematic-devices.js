const catalogue = require('./lib/catalogue');
const mapping = require('./lib/mapping');
const roles = require('./lib/roles');
const {HomematicDevice} = require('./lib/hm-device');
const {trackBridge} = require('./lib/status');

module.exports = function (RED) {
    RED.httpAdmin.get(
        '/redmatic-matter/homematic-devices',
        RED.auth.needsPermission('redmatic-matter.read'),
        (req, res) => {
            if (!req.query.config || req.query.config === '_ADD_') {
                res.status(400).send(JSON.stringify({error: 'config missing'}));
                return;
            }

            // editor: what to offer for every device of a ccu-connection node
            const ccu = RED.nodes.getNode(req.query.config);
            if (!ccu || !ccu.metadata) {
                res.status(500).send(JSON.stringify({error: 'ccu-connection node not found or not ready'}));
                return;
            }

            let options = {};
            if (req.query.node) {
                const node = RED.nodes.getNode(req.query.node);
                if (node && node.devices) {
                    options = node.devices;
                }
            }

            res.status(200).send(JSON.stringify(catalogue.describeDevices(ccu, options)));
        },
    );

    class RedMaticMatterHomematicDevices {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.homematicDevices = new Map();
            this.bridgeConfig = RED.nodes.getNode(config.bridgeConfig);
            if (!this.bridgeConfig || !this.bridgeConfig.bridge) {
                this.status({fill: 'red', shape: 'ring', text: 'no bridge'});
                return;
            }

            this.bridge = this.bridgeConfig.bridge;
            this.ccu = RED.nodes.getNode(config.ccuConfig);
            this.devices = config.devices || {};

            if (!this.ccu) {
                this.status({fill: 'red', shape: 'ring', text: 'no ccu-connection'});
                return;
            }

            // the bridge must not go online before our endpoints exist (D-8)
            this.releaseHold = this.bridge.hold('homematic ' + this.id);
            this.untrack = trackBridge(this, this.bridge, () => this.detail);
            this.detail = 'waiting for ccu';
            this.ccu.register(this);

            this.on('close', (removed, done) => {
                this.closing = true;
                clearTimeout(this.readyTimer);
                this.untrack();
                this.releaseHold();
                this.ccu.deregister(this);
                const stops = [];
                for (const hm of this.homematicDevices.values()) {
                    if (removed) {
                        stops.push(hm.remove({erase: true}));
                    } else {
                        hm.stop();
                    }
                }

                Promise.all(stops).then(() => done());
            });
        }

        /** ccu-connection calls this with the interface states */
        setStatus(data) {
            this.ccuStatus = data;
            const connected = Object.values(data.ifaceStatus || {}).filter(Boolean).length;
            if (connected < 1) {
                this.detail = 'ccu disconnected';
            } else if (connected === this.ccu.enabledIfaces.length) {
                this.detail = 'ccu connected';
                if (!this.ccuConnected) {
                    this.ccuConnected = true;
                    this.publishWhenReady();
                }
            } else {
                this.detail = 'ccu partly connected';
            }

            this.untrack.update();
        }

        /**
         * Wait until the ccu-connection's device list and channel names have
         * arrived and settled before publishing (RedMatic-HomeKit 4.0 found the
         * first-deploy race: an interface marks itself connected before its
         * device list arrives, and an interface without devices never pushes one).
         */
        publishWhenReady(attempt = 0, seen = null, stableFor = 0) {
            if (this.closing) {
                return;
            }

            const devices = (this.ccu.metadata && this.ccu.metadata.devices) || {};
            const count = this.ccu.enabledIfaces.reduce((n, iface) => n + Object.keys(devices[iface] || {}).length, 0);
            const names = Object.keys(this.ccu.channelNames || {}).length;
            const key = count + '/' + names;
            stableFor = count > 0 && names > 0 && key === seen ? stableFor + 1 : 0;
            if (stableFor < this.readyStable && attempt < this.readyAttempts) {
                if (attempt === 0) {
                    this.log('waiting for the ccu device list (' + key + ' devices/names)');
                    this.detail = 'waiting for devices';
                    this.untrack.update();
                }

                this.readyTimer = setTimeout(
                    () => this.publishWhenReady(attempt + 1, key, stableFor),
                    this.readyInterval,
                );
                return;
            }

            this.publishDevices().then(() => {
                this.log(
                    'published ' + this.homematicDevices.size + ' devices with ' + this.endpointCount() + ' endpoints',
                );
                this.detail = this.endpointCount() + ' endpoints';
                this.untrack.update();
                this.releaseHold();
            });
        }

        endpointCount() {
            let n = 0;
            for (const hm of this.homematicDevices.values()) {
                n += hm.devices.length;
            }

            return n;
        }

        /** every selected device of the enabled interfaces (opt-in, D-7) */
        async publishDevices() {
            const wanted = new Set();
            for (const [address, entry] of Object.entries(this.devices)) {
                if (entry && entry.enabled && !address.includes(':')) {
                    wanted.add(address);
                }
            }

            for (const address of wanted) {
                const iface = this.ccu.findIface(address);
                const description =
                    iface && this.ccu.metadata.devices[iface] && this.ccu.metadata.devices[iface][address];
                if (!iface || !this.ccu.enabledIfaces.includes(iface) || !description) {
                    this.warn('device ' + address + ' not found on the CCU');
                    continue;
                }

                const channelModes = await this.channelModes(iface, description);
                try {
                    const p = mapping.plan(description, this.ccu, iface, this.devices, channelModes);
                    if (!p.supported) {
                        this.warn('device ' + address + ' (' + description.TYPE + ') has no Matter equivalent');
                        continue;
                    }

                    const hm = new HomematicDevice(p, {
                        ccu: this.ccu,
                        bridge: this.bridge,
                        log: (level, m) => this.logAt(level, m),
                    });
                    hm.start();
                    this.homematicDevices.set(address, hm);
                    this.debug(
                        'device ' + address + ' ' + description.TYPE + ': ' + hm.devices.map((d) => d.id).join(', '),
                    );
                } catch (error) {
                    this.error('mapping failed for ' + address + ' ' + description.TYPE + ': ' + error.stack);
                }
            }

            // endpoints of devices that are no longer selected
            const keep = new Set();
            for (const hm of this.homematicDevices.values()) {
                for (const device of hm.devices) {
                    keep.add(device.id);
                }
            }

            for (const device of this.bridge.devices.values()) {
                if (this.ownsAddress(device.spec.ownerId) && !keep.has(device.id)) {
                    this.log('removing endpoint ' + device.id + ' (device no longer selected)');
                    this.bridge.removeDevice(device.id, {erase: true});
                }
            }
        }

        /** does an endpoint owner id look like a channel address of this CCU (not a Node-RED node id)? */
        ownsAddress(ownerId) {
            const address = String(ownerId).split(':')[0];
            return Boolean(this.ccu.findIface && this.ccu.findIface(address));
        }

        logAt(level, message) {
            const fn = typeof this[level] === 'function' ? this[level] : this.log;
            fn.call(this, message);
        }

        /**
         * CHANNEL_OPERATION_MODE of every HmIP multi-mode input channel of a
         * device (HmIPW-DRI16/DRI32/FIO6, HmIP-FCI1/FCI6/DSD-PCB, …), read
         * from the channel's MASTER paramset (RedMatic-HomeKit 4.0.0-dev.12).
         * @returns {Promise<Object<string, string>>} address → mode name
         */
        channelModes(iface, device) {
            const devices = (this.ccu.metadata && this.ccu.metadata.devices[iface]) || {};
            const inputs = (device.CHILDREN || [])
                .map((address) => devices[address])
                .filter((channel) => channel && /_INPUT_TRANSMITTER$/.test(channel.TYPE));
            if (inputs.length === 0 || typeof this.ccu.methodCall !== 'function') {
                return Promise.resolve({});
            }

            this.modeCache = this.modeCache || {};
            const modes = {};
            const lookups = inputs.map((channel) => {
                if (this.modeCache[channel.ADDRESS]) {
                    modes[channel.ADDRESS] = this.modeCache[channel.ADDRESS];
                    return Promise.resolve();
                }

                const timeout = new Promise((resolve) => setTimeout(resolve, 3000, null));
                return Promise.race([this.ccu.methodCall(iface, 'getParamset', [channel.ADDRESS, 'MASTER']), timeout])
                    .then((master) => {
                        const raw = master && master.CHANNEL_OPERATION_MODE;
                        if (raw === undefined || raw === null) {
                            return;
                        }

                        const description = this.ccu.getParamsetDescription(
                            iface,
                            channel,
                            'MASTER',
                            'CHANNEL_OPERATION_MODE',
                        );
                        const list = (description && description.VALUE_LIST) || roles.INPUT_MODES;
                        const mode = typeof raw === 'number' ? list[raw] : String(raw);
                        if (mode) {
                            modes[channel.ADDRESS] = mode;
                            this.modeCache[channel.ADDRESS] = mode;
                        }
                    })
                    .catch((error) => {
                        this.debug('getParamset MASTER ' + channel.ADDRESS + ' failed: ' + error.message);
                    });
            });

            return Promise.all(lookups).then(() => modes);
        }

        get readyInterval() {
            return this._readyInterval || 1000;
        }

        set readyInterval(ms) {
            this._readyInterval = ms;
        }

        get readyStable() {
            return this._readyStable || 3;
        }

        set readyStable(n) {
            this._readyStable = n;
        }

        get readyAttempts() {
            return this._readyAttempts || 60;
        }

        set readyAttempts(n) {
            this._readyAttempts = n;
        }
    }

    RED.nodes.registerType('redmatic-matter-homematic-devices', RedMaticMatterHomematicDevices);
};
