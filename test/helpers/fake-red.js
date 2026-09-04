/* Minimal stand-in for the Node-RED runtime object handed to node modules
   (from RedMatic-HomeKit): enough to load node sets, create node instances,
   capture admin HTTP handlers and run close handlers, without booting
   Node-RED. */

const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LEVELS = ['error', 'warn', 'log', 'debug', 'trace'];

function initNode(node, RED, config) {
    EventEmitter.call(node);
    node.RED = RED;
    node.id = config.id;
    node.type = config.type;
    node.name = config.name;
    node.logged = {};
    node.statuses = [];
    node.sent = [];
    for (const level of LEVELS) {
        node.logged[level] = [];
        node[level] = (...args) => {
            node.logged[level].push(args);
        };
    }

    node.status = (status) => node.statuses.push(status);
    node.send = (msg) => node.sent.push(msg);
    node.receive = (msg) =>
        node.emit(
            'input',
            msg,
            () => {},
            () => {},
        );
}

function createFakeRED({userDir} = {}) {
    const types = {};
    const nodes = {};
    const routes = {get: {}, post: {}};

    if (!userDir) {
        userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redmatic-matter-test-'));
    }

    const RED = {
        settings: {userDir, logging: {console: {level: 'info'}}},
        httpAdmin: {
            get(route, ...handlers) {
                routes.get[route] = handlers[handlers.length - 1];
            },
            post(route, ...handlers) {
                routes.post[route] = handlers[handlers.length - 1];
            },
        },
        auth: {
            needsPermission() {
                return (req, res, next) => next();
            },
        },
        util: {
            evaluateNodeProperty(value, type, node, msg, callback) {
                let result = value;
                switch (type) {
                    case 'num':
                        result = Number(value);
                        break;
                    case 'bool':
                        result = value === true || value === 'true';
                        break;
                    case 'json':
                        result = JSON.parse(value);
                        break;
                    case 'date':
                        result = Date.now();
                        break;
                    case 'flow':
                    case 'global':
                        result = 'ctx:' + value;
                        break;
                    default:
                }

                if (callback) {
                    callback(null, result);
                }

                return result;
            },
        },
        nodes: {
            registerType(type, Class) {
                // node classes in this package do not extend anything; give them
                // EventEmitter behaviour like Node-RED's Node base class
                if (!(Class.prototype instanceof EventEmitter)) {
                    Object.setPrototypeOf(Class.prototype, EventEmitter.prototype);
                }

                types[type] = Class;
            },
            createNode(node, config) {
                initNode(node, RED, config);
                nodes[config.id] = node;
            },
            getNode(id) {
                return nodes[id];
            },
        },
        // test helpers
        types,
        routes,
        load(file) {
            require(file)(RED);
            return RED;
        },
        instantiate(type, config) {
            const Class = types[type];
            if (!Class) {
                throw new Error('unknown node type ' + type);
            }

            config = {type, ...config};
            return new Class(config);
        },
        /** run a node's close handlers like Node-RED does (removed = node deleted) */
        async close(node, removed = false) {
            for (const handler of node.listeners('close')) {
                if (handler.length >= 2) {
                    await new Promise((resolve) => handler(removed, resolve));
                } else if (handler.length === 1) {
                    await new Promise((resolve) => handler(resolve));
                } else {
                    await handler();
                }
            }

            delete nodes[node.id];
        },
        /** call an admin GET route; returns {status, body} */
        async get(route, query = {}, params = {}) {
            return call(routes.get[route], {query, params, body: {}});
        },
        async post(route, params = {}, body = {}) {
            return call(routes.post[route], {query: {}, params, body});
        },
        cleanup() {
            fs.rmSync(userDir, {recursive: true, force: true});
        },
    };

    return RED;
}

function call(handler, req) {
    if (!handler) {
        throw new Error('no such route');
    }

    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            send(body) {
                resolve({status: this.statusCode, body: typeof body === 'string' ? JSON.parse(body) : body});
            },
            json(body) {
                resolve({status: this.statusCode, body});
            },
        };
        handler(req, res);
    });
}

module.exports = {createFakeRED};
