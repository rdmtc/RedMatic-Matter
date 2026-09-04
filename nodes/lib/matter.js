/* The Matter layer (ROADMAP task 7): one shared matter.js Environment and
   storage root per process, a `MatterBridge` per bridge config node with a
   ServerNode and an aggregator, and `Device` handles the nodes use to feed
   endpoint state and receive controller writes and commands.

   Nothing Node-RED specific lives here so it stays testable with `node
   --test` alone. matter.js is loaded lazily on the first `MatterBridge`:
   `require('@matter/main')` costs seconds and ≈ 160 MB RSS that a Node-RED
   without a bridge node should not pay.

   Identity (ROADMAP D-4, D-8): the ServerNode id is the bridge id, so
   matter.js keeps fabrics and endpoint numbers in `<storage root>/<bridge
   id>`; an endpoint id is `<owner id>~<type key>`, so the same address with
   the same device type always gets the same endpoint number, and a changed
   shape (a channel re-typed from light to plug-in unit) gets a new identity
   instead of confusing the controller. */

const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');
const path = require('path');

const devices = require('./devices');
const pairing = require('./pairing');
const {vendorName} = require('./vendors');

let storagePath;
let loaded;

/**
 * Process-wide storage root, `<userDir>/matter`. Only the first call counts
 * (matter.js reads it from the environment once), like HomeKit's HAPStorage.
 */
function setStoragePath(dir) {
    if (!storagePath) {
        storagePath = dir;
    }

    return storagePath;
}

function getStoragePath() {
    return storagePath;
}

/** lazy require of matter.js; sets the environment variables once */
function load(options = {}) {
    if (loaded) {
        return loaded;
    }

    if (!storagePath) {
        throw new Error('storage path not set (call setStoragePath first)');
    }

    const t0 = Date.now();
    const main = require('@matter/main');
    const protocol = require('@matter/main/protocol');
    const {AggregatorEndpoint} = require('@matter/main/endpoints/aggregator');
    const commands = require('./commands');

    const {Environment, Logger, LogLevel} = main;
    Environment.default.vars.set('storage.path', storagePath);
    // mDNS options are environment-wide (one MdnsService per process, ROADMAP D-5)
    if (options.ipv4 === false) {
        Environment.default.vars.set('mdns.ipv4', false);
    }

    if (options.networkInterface) {
        Environment.default.vars.set('mdns.networkInterface', options.networkInterface);
    }

    if (options.logLevel) {
        Logger.level = LogLevel[options.logLevel] ?? Logger.level;
    } else {
        Logger.level = LogLevel.WARN;
    }

    loaded = {
        main,
        protocol,
        AggregatorEndpoint,
        commands,
        loadTime: Date.now() - t0,
        rss: process.memoryUsage().rss,
    };
    return loaded;
}

function deepMerge(target, patch) {
    for (const [k, v] of Object.entries(patch || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
            deepMerge(target[k], v);
        } else {
            target[k] = v;
        }
    }

    return target;
}

/** interfaces with an IPv6 address (D-14: the node checks and reports, it does not fix) */
function ipv6Interfaces(networkInterface) {
    const result = [];
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
        if (networkInterface && name !== networkInterface) {
            continue;
        }

        if ((addresses || []).some((a) => a.family === 'IPv6' || a.family === 6)) {
            result.push(name);
        }
    }

    return result;
}

/** is a UDP port free for exclusive use (matter.js binds the operational port without reuse) */
function udpPortFree(port) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket({type: 'udp6', ipv6Only: false});
        socket.once('error', () => resolve(false));
        socket.bind(port, () => {
            socket.close(() => resolve(true));
        });
    });
}

const bridges = new Map();

/**
 * Handle for one bridged endpoint, owned by a Node-RED node. Created through
 * `bridge.device(spec)`; state patches before the endpoint exists are
 * collected and applied when it is created.
 */
class Device extends EventEmitter {
    constructor(bridge, spec, built) {
        super();
        this.bridge = bridge;
        this.spec = spec;
        this.built = built;
        this.id = spec.endpointId;
        this.typeKey = built.key;
        this.pending = deepMerge({}, built.state);
        this.endpoint = null;
        this.listeners = [];
        this.commandHandler = null;
        this.attached = true;
    }

    get number() {
        return this.endpoint ? this.endpoint.maybeNumber : undefined;
    }

    /** current state (matter.js' immutable view) or the pending initial state */
    get state() {
        return this.endpoint && this.endpoint.lifecycle.isReady ? this.endpoint.state : this.pending;
    }

    /**
     * Patch attribute values, e.g. {onOff: {onOff: true}}. `pending` shadows
     * every patch so a re-created endpoint (factory reset, restart of the
     * Matter node) starts from the last known values.
     */
    set(patch) {
        deepMerge(this.pending, patch);
        if (this.endpoint && this.endpoint.lifecycle.isReady) {
            return this.endpoint.set(patch).catch((error) => {
                this.bridge.log('warn', 'set ' + this.id + ' ' + JSON.stringify(patch) + ' failed: ' + error.message);
            });
        }

        return Promise.resolve();
    }

    setReachable(reachable) {
        return this.set({bridgedDeviceBasicInformation: {reachable: Boolean(reachable)}});
    }

    setLabel(name) {
        return this.set({bridgedDeviceBasicInformation: {nodeLabel: pairing.label(name)}});
    }

    /**
     * Listen to attribute changes. `fn(value, {old, local, remote, context})`
     * — `local` is true for changes this process made through `set()`, so
     * nodes forward only what a controller wrote (echo suppression).
     */
    onChange(cluster, attribute, fn) {
        const entry = {cluster, attribute, fn, off: null};
        this.listeners.push(entry);
        if (this.endpoint && this.endpoint.lifecycle.isReady) {
            this.attachListener(entry);
        }

        return this;
    }

    /** `fn(command, request)` for command-driven clusters (see commands.js) */
    onCommand(fn) {
        this.commandHandler = fn;
        if (this.endpoint) {
            this.bridge.lib.commands.setHandler(this.endpoint, fn);
        }

        return this;
    }

    attachListener(entry) {
        const events = this.endpoint.events[entry.cluster];
        const event = events && events[entry.attribute + '$Changed'];
        if (!event) {
            this.bridge.log(
                'warn',
                this.id + ': no attribute ' + entry.cluster + '/' + entry.attribute + ' to listen to',
            );
            return;
        }

        const {hasLocalActor, hasRemoteActor} = this.bridge.lib.protocol;
        const handler = (value, old, context) => {
            const local = context ? hasLocalActor(context) : true;
            const remote = context ? hasRemoteActor(context) : false;
            try {
                entry.fn(value, {old, local, remote, context});
            } catch (error) {
                this.bridge.log('error', this.id + ' change handler failed: ' + error.stack);
            }
        };

        event.on(handler);
        entry.off = () => event.off(handler);
    }

    /** every `<cluster>/<attribute>` the endpoint has (universal node output) */
    attributes() {
        if (!this.endpoint || !this.endpoint.lifecycle.isReady) {
            return [];
        }

        const result = [];
        for (const [cluster, state] of Object.entries(this.endpoint.state)) {
            for (const attribute of Object.keys(state || {})) {
                result.push(cluster + '/' + attribute);
            }
        }

        return result;
    }

    /** called by the bridge once the matter.js endpoint exists and is ready */
    installed(endpoint) {
        this.endpoint = endpoint;
        for (const entry of this.listeners) {
            if (!entry.off) {
                this.attachListener(entry);
            }
        }

        if (this.commandHandler) {
            this.bridge.lib.commands.setHandler(endpoint, this.commandHandler);
        }

        this.emit('ready');
    }

    /** remove listeners and the command handler; the endpoint stays (redeploy) */
    detach() {
        for (const entry of this.listeners) {
            if (entry.off) {
                entry.off();
                entry.off = null;
            }
        }

        this.listeners = [];
        this.commandHandler = null;
        if (this.endpoint) {
            this.bridge.lib.commands.setHandler(this.endpoint, null);
        }

        this.attached = false;
    }
}

/**
 * One Matter bridge: a ServerNode with an aggregator endpoint. Created by
 * the bridge config node and kept across deploys in a module-level registry
 * keyed by bridge id (D-8).
 */
class MatterBridge extends EventEmitter {
    /**
     * @param {object} options
     * @param {string} options.id  bridge id (ServerNode id and storage directory)
     * @param {string} options.name  announced name
     * @param {number} options.port  UDP port (5540 default)
     * @param {number} options.passcode
     * @param {number} options.discriminator
     * @param {number} [options.vendorId]
     * @param {number} [options.productId]
     * @param {string} [options.version]  software version string
     * @param {boolean} [options.ipv4]  mDNS over IPv4 (default true; process-wide)
     * @param {string} [options.networkInterface]  limit mDNS to one interface (process-wide)
     * @param {number} [options.startDelay]  ms to wait after the last endpoint before going online
     * @param {number} [options.startTimeout]  ms after which the bridge starts even with holds pending
     * @param {function} [options.log]  (level, message)
     */
    constructor(options) {
        super();
        this.options = {startDelay: 2000, startTimeout: 90000, ...options};
        this.id = options.id;
        this.logFn = options.log || (() => {});
        this.devices = new Map();
        this.holds = new Set();
        this.state = 'idle';
        this.error = null;
        this.server = null;
        this.aggregator = null;
        this.lib = null;
        this.queue = Promise.resolve();
        this.startTimer = null;
        this.startDeadline = null;
    }

    log(level, message) {
        this.logFn(level, '[' + this.id + '] ' + message);
    }

    static get(id) {
        return bridges.get(id);
    }

    static register(bridge) {
        bridges.set(bridge.id, bridge);
        return bridge;
    }

    static unregister(id) {
        bridges.delete(id);
    }

    static all() {
        return [...bridges.values()];
    }

    get online() {
        return this.state === 'online';
    }

    /**
     * Get or create the endpoint for a spec:
     *   {ownerId, type, options, label, productName, serialNumber, hardwareVersion, softwareVersion}
     * The endpoint id is `<ownerId>~<type key>`. An existing device with the
     * same id is reused (its listeners are replaced by the caller's); an
     * existing device of the same owner with a different type key is removed
     * (identity rotation, D-8).
     */
    device(spec) {
        const built = devices.build(spec.type, spec.options || {});
        const endpointId = pairing.endpointId(spec.ownerId) + '~' + built.key;
        const label = pairing.label(spec.label, spec.ownerId);
        const existing = this.devices.get(endpointId);
        if (existing) {
            existing.detach();
            existing.attached = true;
            existing.spec = {...existing.spec, ...spec, endpointId};
            existing.setLabel(label);
            existing.setReachable(spec.reachable !== false);
            this.scheduleStart();
            return existing;
        }

        // same owner, different shape → the old endpoint goes
        for (const other of [...this.devices.values()]) {
            if (other.spec.ownerId === spec.ownerId && other.id !== endpointId) {
                this.log('log', 'endpoint ' + other.id + ' replaced by ' + endpointId);
                this.removeDevice(other.id, {erase: true});
            }
        }

        const device = new Device(this, {...spec, endpointId}, built);
        if (spec.state) {
            deepMerge(device.pending, spec.state);
        }

        deepMerge(device.pending, {
            bridgedDeviceBasicInformation: {
                nodeLabel: label,
                productName: pairing.label(spec.productName, 'RedMatic'),
                productLabel: pairing.label(spec.productName, 'RedMatic'),
                serialNumber: pairing.label(spec.serialNumber || spec.ownerId),
                hardwareVersionString: pairing.label(spec.hardwareVersion, '1'),
                softwareVersionString: pairing.label(spec.softwareVersion || this.options.version, '1'),
                reachable: spec.reachable !== false,
                uniqueId: pairing.uniqueId(this.id, endpointId),
            },
        });
        this.devices.set(endpointId, device);
        if (this.server) {
            this.enqueue(() => this.install(device));
        }

        this.scheduleStart();
        return device;
    }

    /** endpoints whose owner id starts with the prefix (a node's endpoints) */
    devicesOf(ownerPrefix) {
        return [...this.devices.values()].filter((d) => String(d.spec.ownerId).startsWith(ownerPrefix));
    }

    /**
     * Remove an endpoint. `erase: true` deletes its stored data (node
     * deleted); otherwise the endpoint is closed and its endpoint number
     * survives a later re-add.
     */
    removeDevice(endpointId, {erase = false} = {}) {
        const device = this.devices.get(endpointId);
        if (!device) {
            return Promise.resolve();
        }

        device.detach();
        this.devices.delete(endpointId);
        if (!device.endpoint) {
            return Promise.resolve();
        }

        const endpoint = device.endpoint;
        device.endpoint = null;
        return this.enqueue(async () => {
            try {
                if (erase) {
                    await endpoint.delete();
                } else {
                    await endpoint.close();
                }
            } catch (error) {
                this.log('warn', 'remove ' + endpointId + ' failed: ' + error.message);
            }
        });
    }

    /**
     * Delay the start until the holder releases (the homematic node holds
     * while it waits for the CCU); every endpoint must exist before the
     * bridge goes online (D-8).
     */
    hold(name) {
        this.holds.add(name);
        this.scheduleStart();
        return () => {
            this.holds.delete(name);
            this.scheduleStart();
        };
    }

    scheduleStart() {
        if (this.server || this.state === 'starting' || this.state === 'stopped') {
            return;
        }

        clearTimeout(this.startTimer);
        if (!this.startDeadline) {
            this.startDeadline = Date.now() + this.options.startTimeout;
        }

        const overdue = Date.now() >= this.startDeadline;
        if (this.holds.size > 0 && !overdue) {
            this.startTimer = setTimeout(() => this.scheduleStart(), Math.min(1000, this.options.startTimeout));
            this.startTimer.unref();
            return;
        }

        if (overdue && this.holds.size > 0) {
            this.log('warn', 'starting without ' + [...this.holds].join(', ') + ' (timeout)');
        }

        this.startTimer = setTimeout(() => {
            this.start().catch((error) => {
                this.log('error', 'start failed: ' + error.message);
            });
        }, this.options.startDelay);
        this.startTimer.unref();
    }

    enqueue(task) {
        this.queue = this.queue.then(task, task);
        return this.queue;
    }

    async install(device) {
        if (!this.aggregator || !device.attached || device.endpoint) {
            return;
        }

        const {Endpoint} = this.lib.main;
        const endpoint = new Endpoint(device.built.type, {id: device.id, ...device.pending});
        try {
            await this.aggregator.add(endpoint);
        } catch (error) {
            this.log('error', 'endpoint ' + device.id + ' failed to initialise: ' + describeError(error));
            this.devices.delete(device.id);
            device.emit('error', error);
            return;
        }

        device.installed(endpoint);
        this.log('debug', 'endpoint ' + device.id + ' = ' + endpoint.number + ' (' + device.built.key + ')');
    }

    /** create the ServerNode, add every known endpoint, go online */
    start() {
        clearTimeout(this.startTimer);
        if (this.server) {
            return this.queue;
        }

        this.state = 'starting';
        return this.enqueue(() => this.doStart());
    }

    async doStart() {
        const o = this.options;
        this.error = null;
        try {
            this.lib = load({ipv4: o.ipv4, networkInterface: o.networkInterface, logLevel: o.logLevel});
        } catch (error) {
            this.fail('matter.js could not be loaded: ' + error.message);
            return;
        }

        const v6 = ipv6Interfaces(o.networkInterface);
        if (v6.length === 0) {
            this.fail(
                'no IPv6 address on ' +
                    (o.networkInterface || 'any interface') +
                    ' — Matter controllers cannot reach this bridge; update RedMatic',
            );
            return;
        }

        if (!(await udpPortFree(o.port))) {
            this.fail('UDP port ' + o.port + ' is in use — choose another port for this bridge');
            return;
        }

        const {ServerNode, Endpoint, VendorId} = this.lib.main;
        try {
            this.server = await ServerNode.create({
                id: this.id,
                network: {port: o.port},
                commissioning: {passcode: o.passcode, discriminator: o.discriminator},
                productDescription: {
                    name: pairing.label(o.name, 'RedMatic'),
                    deviceType: this.lib.AggregatorEndpoint.deviceType,
                },
                basicInformation: {
                    vendorName: 'RedMatic',
                    vendorId: VendorId(o.vendorId || 0xfff1),
                    nodeLabel: pairing.label(o.name, 'RedMatic'),
                    productName: 'RedMatic Matter Bridge',
                    productLabel: 'Matter Bridge',
                    productId: o.productId || 0x8000,
                    serialNumber: pairing.label(this.id),
                    uniqueId: pairing.uniqueId('bridge', this.id),
                    softwareVersionString: pairing.label(o.version, '1'),
                    softwareVersion: versionNumber(o.version),
                    hardwareVersionString: '1',
                    hardwareVersion: 1,
                },
            });
            this.aggregator = new Endpoint(this.lib.AggregatorEndpoint, {id: 'aggregator'});
            await this.server.add(this.aggregator);
            for (const device of this.devices.values()) {
                await this.install(device);
            }

            this.server.lifecycle.commissioned.on(() => this.emit('fabricsChanged'));
            this.server.lifecycle.decommissioned.on(() => this.emit('fabricsChanged'));
            this.server.events.commissioning.fabricsChanged.on(() => this.emit('fabricsChanged'));
            this.server.lifecycle.online.on(() => {
                this.state = 'online';
                this.emit('online');
            });
            this.server.lifecycle.offline.on(() => {
                if (this.state === 'online') {
                    this.state = 'offline';
                    this.emit('offline');
                }
            });
            await this.server.start();
            this.state = 'online';
            const codes = this.pairingCodes;
            this.log(
                'log',
                'bridge online on port ' +
                    o.port +
                    ' with ' +
                    this.devices.size +
                    ' endpoints' +
                    (this.commissioned
                        ? ', ' + this.fabrics.length + ' fabrics'
                        : ', pairing code ' + codes.manualPairingCode + ' (' + codes.qrPairingCode + ')'),
            );
            this.emit('online');
        } catch (error) {
            this.fail('start failed: ' + describeError(error));
            await this.destroyServer();
        }
    }

    fail(message) {
        this.state = 'error';
        this.error = message;
        this.log('error', message);
        this.emit('error', new Error(message));
    }

    async destroyServer() {
        const server = this.server;
        this.server = null;
        this.aggregator = null;
        for (const device of this.devices.values()) {
            device.endpoint = null;
            for (const entry of device.listeners) {
                entry.off = null;
            }
        }

        if (server) {
            try {
                await server.close();
            } catch (error) {
                this.log('warn', 'close failed: ' + error.message);
            }
        }
    }

    /** stop the ServerNode; the storage stays */
    stop() {
        clearTimeout(this.startTimer);
        return this.enqueue(async () => {
            await this.destroyServer();
            this.state = 'stopped';
            this.emit('offline');
        });
    }

    get commissioned() {
        return Boolean(this.server && this.server.state.commissioning.commissioned);
    }

    get pairingCodes() {
        if (!this.server) {
            return null;
        }

        return {...this.server.state.commissioning.pairingCodes};
    }

    /** [{index, vendorId, vendor, label, nodeId, fabricId}] */
    get fabrics() {
        if (!this.server) {
            return [];
        }

        return Object.values(this.server.state.commissioning.fabrics || {}).map((f) => ({
            index: Number(f.fabricIndex),
            vendorId: Number(f.rootVendorId),
            vendor: vendorName(f.rootVendorId),
            label: f.label,
            nodeId: String(f.nodeId),
            fabricId: String(f.fabricId),
        }));
    }

    /** what the editor dialog and the node status show */
    info() {
        return {
            id: this.id,
            name: this.options.name,
            port: this.options.port,
            state: this.state,
            error: this.error,
            online: this.online,
            commissioned: this.commissioned,
            pairingCodes: this.pairingCodes,
            fabrics: this.fabrics,
            endpoints: [...this.devices.values()].map((d) => ({
                id: d.id,
                number: d.number,
                type: d.typeKey,
                label: d.spec.label,
                owner: d.spec.ownerId,
            })),
            storage: storagePath ? path.join(storagePath, this.id) : null,
        };
    }

    /** unpair one controller without touching the others */
    removeFabric(index) {
        if (!this.server) {
            return Promise.reject(new Error('bridge is not running'));
        }

        const {FabricManager} = this.lib.protocol;
        const manager = this.server.env.get(FabricManager);
        const fabric = manager.fabrics.find((f) => Number(f.fabricIndex) === Number(index));
        if (!fabric) {
            return Promise.reject(new Error('no fabric with index ' + index));
        }

        return this.enqueue(async () => {
            await fabric.leave();
            this.emit('fabricsChanged');
        });
    }

    /** advertise for commissioning again (multi-admin: add a second controller) */
    openCommissioningWindow() {
        if (!this.server) {
            return Promise.reject(new Error('bridge is not running'));
        }

        return this.enqueue(() => this.server.act((agent) => agent.commissioning.enterCommissionableMode()));
    }

    /**
     * Forget every fabric and all stored state: close the node, delete its
     * storage directory and start again with the same endpoints (their
     * numbers start over, which is what a factory reset means to a
     * controller). matter.js' own `ServerNode.erase()` is not used: a node
     * that was erased in place can no longer be closed completely (sockets
     * and the storage lock stay open, matter.js 0.17.9).
     */
    factoryReset() {
        return this.enqueue(async () => {
            if (!this.server) {
                throw new Error('bridge is not running');
            }

            await this.destroyServer();
            const dir = path.join(storagePath, this.id);
            await fs.promises.rm(dir, {recursive: true, force: true});
            this.log('log', 'factory reset: storage ' + dir + ' removed');
            this.state = 'idle';
            this.startDeadline = null;
            await this.doStart();
            this.emit('fabricsChanged');
        });
    }
}

function versionNumber(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
    return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 1;
}

/** matter.js wraps initialisation errors; dig out the "Caused by" line */
function describeError(error) {
    const text = String((error && error.stack) || error);
    const cause = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^Caused by:/.test(l));
    return cause.length > 0 ? cause[cause.length - 1].replace(/^Caused by:\s*/, '') : String(error.message || error);
}

module.exports = {
    setStoragePath,
    getStoragePath,
    load,
    MatterBridge,
    Device,
    ipv6Interfaces,
    udpPortFree,
    describeError,
    deepMerge,
};
