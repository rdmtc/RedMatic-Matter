const path = require('path');
const matter = require('./lib/matter');
const pairing = require('./lib/pairing');
const pkg = require('../package.json');

module.exports = function (RED) {
    // the storage root is process-wide and set once (ROADMAP D-4)
    matter.setStoragePath(path.join(RED.settings.userDir, 'matter'));

    const nodeLogger = (node) => (level, message) => {
        if (typeof node[level] === 'function') {
            node[level](message);
        } else {
            node.log(message);
        }
    };

    function bridgeOf(req, res) {
        const id = req.query.config || req.params.id;
        const node = id && id !== '_ADD_' ? RED.nodes.getNode(id) : null;
        if (!node || !node.bridge) {
            res.status(404).send(JSON.stringify({error: 'bridge node not deployed'}));
            return null;
        }

        return node.bridge;
    }

    /** dialog: suggestions for a new bridge or the live state of a deployed one */
    RED.httpAdmin.get('/redmatic-matter/bridge', RED.auth.needsPermission('redmatic-matter.read'), (req, res) => {
        if (req.query.suggest) {
            res.status(200).send(
                JSON.stringify({
                    bridgeId: pairing.randomBridgeId(),
                    passcode: pairing.randomPasscode(),
                    discriminator: pairing.randomDiscriminator(),
                    interfaces: matter.ipv6Interfaces(),
                }),
            );
            return;
        }

        const bridge = bridgeOf(req, res);
        if (bridge) {
            res.status(200).send(JSON.stringify(bridge.info()));
        }
    });

    const actions = {
        removeFabric: (bridge, body) => bridge.removeFabric(Number(body.index)),
        openCommissioningWindow: (bridge) => bridge.openCommissioningWindow(),
        factoryReset: (bridge) => bridge.factoryReset(),
    };

    RED.httpAdmin.post(
        '/redmatic-matter/bridge/:id/:action',
        RED.auth.needsPermission('redmatic-matter.write'),
        (req, res) => {
            const bridge = bridgeOf(req, res);
            if (!bridge) {
                return;
            }

            const action = actions[req.params.action];
            if (!action) {
                res.status(400).send(JSON.stringify({error: 'unknown action ' + req.params.action}));
                return;
            }

            Promise.resolve()
                .then(() => action(bridge, req.body || {}))
                .then(() => res.status(200).send(JSON.stringify(bridge.info())))
                .catch((error) => res.status(500).send(JSON.stringify({error: error.message})));
        },
    );

    class RedMaticMatterBridge {
        constructor(config) {
            RED.nodes.createNode(this, config);

            const problems = [];
            if (!pairing.isValidBridgeId(config.bridgeId)) {
                problems.push('bridge id missing or invalid');
            }

            if (!pairing.isValidPasscode(config.passcode)) {
                problems.push('passcode invalid');
            }

            if (!pairing.isValidDiscriminator(config.discriminator)) {
                problems.push('discriminator invalid');
            }

            if (!pairing.isValidPort(config.port)) {
                problems.push('port invalid');
            }

            if (problems.length > 0) {
                this.error(problems.join(', '));
                return;
            }

            this.name = config.name || 'RedMatic Bridge';
            this.bridgeId = String(config.bridgeId);
            this.version = pkg.version;
            this.matter = matter;

            const options = {
                id: this.bridgeId,
                name: this.name,
                port: Number(config.port),
                passcode: Number(config.passcode),
                discriminator: Number(config.discriminator),
                vendorId: config.vendorId ? Number(config.vendorId) : undefined,
                productId: config.productId ? Number(config.productId) : undefined,
                ipv4: config.ipv4 !== false && config.ipv4 !== 'false',
                networkInterface: config.networkInterface || undefined,
                version: pkg.version,
                log: nodeLogger(this),
            };

            const existing = matter.MatterBridge.get(this.bridgeId);
            if (existing && !changed(existing.options, options)) {
                // redeploy: keep the running ServerNode (D-8); only the logger moves to this node
                existing.logFn = options.log;
                this.bridge = existing;
            } else {
                if (existing) {
                    this.log('bridge settings changed, restarting the Matter node');
                    matter.MatterBridge.unregister(this.bridgeId);
                    existing.stop().catch((error) => this.warn('stop failed: ' + error.message));
                }

                this.bridge = matter.MatterBridge.register(new matter.MatterBridge(options));
            }

            this.on('close', (removed, done) => {
                if (removed && matter.MatterBridge.get(this.bridgeId) === this.bridge) {
                    matter.MatterBridge.unregister(this.bridgeId);
                    this.bridge
                        .stop()
                        .catch((error) => this.warn('stop failed: ' + error.message))
                        .then(() => done());
                    return;
                }

                done();
            });
        }
    }

    RED.nodes.registerType('redmatic-matter-bridge', RedMaticMatterBridge);
};

const RESTART_KEYS = ['name', 'port', 'passcode', 'discriminator', 'vendorId', 'productId', 'ipv4', 'networkInterface'];

function changed(a, b) {
    return RESTART_KEYS.some((key) => (a[key] ?? null) !== (b[key] ?? null));
}
