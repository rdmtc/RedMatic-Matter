/* Runtime of one Homematic device on a Matter bridge (ROADMAP task 7
   "bridge loop" + task 10 step 5): executes the endpoint plans of
   lib/mapping.js against a ccu-connection node and a MatterBridge.

   - CCU events (`ccu.subscribe`) become attribute patches on the endpoints;
   - controller writes and commands become `ccu.setValueQueued` calls, with
     the write rules from the field: a bare "on" of a dimmer is deferred
     (voice assistants send "on" and the level up to ~400 ms apart, the
     level write cancels the deferred restore), explicit values are never
     delayed, echo is suppressed by the actor context (only remote changes
     write);
   - key channels drive GenericSwitch endpoints (a PRESS_LONG stream is one
     long press), and HmIP keys are declared "in use" via reportValueUsage so
     the CCU forwards their presses at all;
   - the maintenance channel feeds battery (PowerSource) and reachability. */

const mapping = require('./mapping');

const DEFER_ON_MS = 500;
const LONG_PRESS_GAP_MS = 1500;

class HomematicDevice {
    /**
     * @param {object} p  plan from mapping.plan()
     * @param {object} deps  {ccu, bridge, log(level, message), timing}
     */
    constructor(p, {ccu, bridge, log = () => {}, timing = {}}) {
        this.plan = p;
        this.ccu = ccu;
        this.bridge = bridge;
        this.log = log;
        this.timing = {deferOn: DEFER_ON_MS, longPressGap: LONG_PRESS_GAP_MS, reportValueUsageRetry: 30000, ...timing};
        this.subscriptions = [];
        this.timers = new Map();
        this.memory = new Map();
        this.devices = [];
        this.closed = false;
    }

    /** create the endpoints and wire them; returns the Device handles */
    start() {
        const p = this.plan;
        const enabled = p.endpoints.filter((e) => e.enabled);
        const single = enabled.length === 1;
        for (const e of enabled) {
            const device = this.bridge.device({
                ownerId: e.address,
                type: e.type,
                options: e.typeOptions,
                label: single ? p.name : e.name,
                productName: p.type,
                serialNumber: e.address,
                hardwareVersion: p.firmware,
                state: e.state,
            });
            device.on('error', (error) => this.log('error', e.address + ' (' + e.type + '): ' + error.message));
            this.devices.push(device);
            this.wire(e, device);
        }

        this.wireMaintenance();
        return this.devices;
    }

    api(e, device) {
        const key = (name) => e.address + '/' + name;
        return {
            remember: (name, value) => this.memory.set(key(name), value),
            recall: (name) => this.memory.get(key(name)),
            current: (datapointName) => this.ccu.values && this.ccu.values[datapointName],
            cancel: (name) => this.clearTimer(key(name)),
            later: (ms, fn) => this.setTimer(key('later-' + Math.random()), ms, fn),
            set: (patch) => device.set(patch),
            state: () => device.state,
        };
    }

    wire(e, device) {
        const api = this.api(e, device);

        for (const sub of e.subscriptions) {
            this.subscribe(
                {cache: true, change: true, stable: sub.stable !== false, datapointName: sub.datapoint},
                (msg) => {
                    let patch;
                    try {
                        patch = sub.handler(msg.value, msg, api);
                    } catch (error) {
                        this.log('error', sub.datapoint + ' handler failed: ' + error.message);
                        return;
                    }

                    if (patch) {
                        this.log(
                            'trace',
                            sub.datapoint + ' = ' + JSON.stringify(msg.value) + ' -> ' + JSON.stringify(patch),
                        );
                        device.set(patch);
                    }
                },
            );
        }

        for (const write of e.writes) {
            device.onChange(write.cluster, write.attribute, (value, meta) => {
                if (!meta.remote) {
                    return;
                }

                this.log(
                    'debug',
                    e.address +
                        ' controller wrote ' +
                        write.cluster +
                        '/' +
                        write.attribute +
                        ' = ' +
                        JSON.stringify(value),
                );
                let result;
                try {
                    result = write.handler(value, {...meta, state: device.state}, api);
                } catch (error) {
                    this.log('error', e.address + ' write handler failed: ' + error.message);
                    return;
                }

                this.execute(e, result);
            });
        }

        if (e.commands.length > 0) {
            const handlers = new Map(e.commands.map((c) => [c.command, c.handler]));
            device.onCommand((command, request) => {
                const handler = handlers.get(command);
                if (!handler) {
                    return;
                }

                this.log('debug', e.address + ' controller command ' + command + ' ' + JSON.stringify(request));
                let result;
                try {
                    result = handler(request || {}, api);
                } catch (error) {
                    this.log('error', e.address + ' command handler failed: ' + error.message);
                    return;
                }

                this.execute(e, result);
            });
        }

        if (e.keys) {
            this.wireKeys(e, device);
        }
    }

    /** write results: null, an array of writes, or {defer, writes} */
    execute(e, result) {
        if (!result) {
            return;
        }

        if (result.defer) {
            const key = e.address + '/' + result.defer;
            this.setTimer(key, this.timing.deferOn, () => this.writeAll(result.writes));
            return;
        }

        this.writeAll(result);
    }

    writeAll(writes) {
        for (const w of writes || []) {
            if (w.value === undefined) {
                continue;
            }

            const datapointName = this.plan.iface + '.' + w.address + '.' + w.datapoint;
            const cached = this.ccu.values && this.ccu.values[datapointName];
            const force = Boolean(cached && cached.stable === false);
            this.log('debug', 'setValue ' + datapointName + ' ' + JSON.stringify(w.value));
            Promise.resolve(
                this.ccu.setValueQueued(this.plan.iface, w.address, w.datapoint, w.value, false, force),
            ).catch((error) => this.log('warn', 'setValue ' + datapointName + ' failed: ' + error.message));
        }
    }

    wireKeys(e, device) {
        const {short, long, release, reportUsage} = e.keys;
        const press = (kind) => {
            const {press: doPress} = require('./press');
            doPress(device, kind, this.timing).catch((error) =>
                this.log('warn', e.address + ' press failed: ' + error.message),
            );
        };

        if (short) {
            this.subscribe({cache: false, change: false, datapointName: short}, () => press('short'));
        }

        if (long) {
            // a held key is a PRESS_LONG every few hundred ms until PRESS_LONG_RELEASE: one Matter long press
            let holding = false;
            const gapKey = e.address + '/long-gap';
            const end = () => {
                if (holding) {
                    holding = false;
                    device.set({switch: {currentPosition: 0}});
                }
            };

            this.subscribe({cache: false, change: false, datapointName: long}, () => {
                if (!holding) {
                    holding = true;
                    device.set({switch: {currentPosition: 1}});
                }

                this.setTimer(gapKey, this.timing.longPressGap, end);
            });
            if (release) {
                this.subscribe({cache: false, change: false, datapointName: release}, () => {
                    this.clearTimer(gapKey);
                    end();
                });
            }
        }

        for (const datapoint of reportUsage) {
            this.reportValueUsage(e.address, datapoint);
        }
    }

    /**
     * HmIP key channels stay silent until the CCU knows somebody uses the
     * datapoint (a program, a link — or us). Battery devices apply it on
     * their next configuration wake-up, until then the CCU answers
     * "Transmission is pending"; retry a few times.
     */
    reportValueUsage(address, datapoint, attempt = 0) {
        if (!/^HmIP/i.test(this.plan.iface) || typeof this.ccu.methodCall !== 'function' || this.closed) {
            return;
        }

        Promise.resolve(this.ccu.methodCall(this.plan.iface, 'reportValueUsage', [address, datapoint, 1]))
            .then(() => this.log('debug', 'reportValueUsage ' + address + ' ' + datapoint))
            .catch((error) => {
                this.log(
                    'debug',
                    'reportValueUsage ' +
                        address +
                        ' ' +
                        datapoint +
                        ' failed: ' +
                        error.message +
                        ' (attempt ' +
                        (attempt + 1) +
                        ')',
                );
                if (attempt < 20) {
                    this.setTimer('rvu/' + address + '/' + datapoint, this.timing.reportValueUsageRetry, () =>
                        this.reportValueUsage(address, datapoint, attempt + 1),
                    );
                }
            });
    }

    wireMaintenance() {
        const m = mapping.maintenancePlan(this.plan);
        const carrier = this.devices.find((d) => d.spec.options && d.spec.options.battery);
        for (const sub of m.subscriptions) {
            this.subscribe({cache: true, change: true, datapointName: sub.datapoint}, (msg) => {
                const patch = sub.handler(msg.value);
                if (!patch) {
                    return;
                }

                if (sub.target === 'all') {
                    for (const device of this.devices) {
                        device.setReachable(patch.reachable);
                    }
                } else if (carrier) {
                    carrier.set(patch);
                }
            });
        }
    }

    subscribe(filter, callback) {
        const id = this.ccu.subscribe(filter, callback);
        if (id !== null && id !== undefined) {
            this.subscriptions.push(id);
        }
    }

    setTimer(key, ms, fn) {
        this.clearTimer(key);
        const timer = setTimeout(() => {
            this.timers.delete(key);
            if (!this.closed) {
                fn();
            }
        }, ms);
        this.timers.set(key, timer);
    }

    clearTimer(key) {
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
    }

    /** unsubscribe, stop timers, detach from the endpoints (they stay on the bridge) */
    stop() {
        this.closed = true;
        for (const id of this.subscriptions.splice(0)) {
            this.ccu.unsubscribe(id);
        }

        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }

        this.timers.clear();
        for (const device of this.devices) {
            device.detach();
        }
    }

    /** remove the endpoints from the bridge (device unticked or node deleted) */
    remove({erase = true} = {}) {
        this.stop();
        return Promise.all(this.devices.map((device) => this.bridge.removeDevice(device.id, {erase})));
    }
}

module.exports = {HomematicDevice, DEFER_ON_MS, LONG_PRESS_GAP_MS};
