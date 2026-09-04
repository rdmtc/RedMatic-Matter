/* Real matter.js ServerNodes on scratch ports for the unit tests (ROADMAP
   task 11): one temporary storage root per process, a fresh bridge id and
   port per bridge, no start delay. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const matter = require('../../nodes/lib/matter');

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redmatic-matter-test-'));
matter.setStoragePath(storageRoot);

// test files run in parallel processes: spread their port ranges by pid (each file uses < 40 ports)
let counter = Number(process.env.MATTER_TEST_PORT_BASE || 50000) + (process.pid % 300) * 40;
const created = [];

function nextPort() {
    counter += 1;
    return counter;
}

/** a MatterBridge that starts as soon as start() is called */
function createBridge(overrides = {}) {
    const port = overrides.port || nextPort();
    const id = overrides.id || 'test-' + port;
    const bridge = new matter.MatterBridge({
        id,
        name: 'Test ' + id,
        port,
        passcode: 20202021,
        discriminator: port % 4096,
        version: '1.0.0-test',
        startDelay: 0,
        startTimeout: 5000,
        log: process.env.MATTER_TEST_LOG ? (level, m) => console.log(level, m) : () => {},
        ...overrides,
    });
    created.push(bridge);
    return bridge;
}

async function stopAll() {
    for (const bridge of created.splice(0)) {
        await bridge.stop();
    }
}

function cleanup() {
    fs.rmSync(storageRoot, {recursive: true, force: true});
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {storageRoot, createBridge, stopAll, cleanup, nextPort, tick, matter};
