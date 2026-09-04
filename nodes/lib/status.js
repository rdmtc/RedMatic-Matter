/* Node status shared by every node that hangs off a bridge: what the bridge
   is doing, in one line. */

/**
 * @param {import('./matter').MatterBridge} bridge
 * @param {string} [detail]  node-specific suffix
 */
function bridgeStatus(bridge, detail) {
    const suffix = detail ? ' · ' + detail : '';
    if (!bridge) {
        return {fill: 'red', shape: 'ring', text: 'no bridge'};
    }

    switch (bridge.state) {
        case 'error':
            return {fill: 'red', shape: 'dot', text: bridge.error || 'error'};
        case 'online': {
            if (bridge.commissioned) {
                const n = bridge.fabrics.length;
                return {fill: 'green', shape: 'dot', text: n + (n === 1 ? ' fabric' : ' fabrics') + suffix};
            }

            const codes = bridge.pairingCodes;
            return {
                fill: 'yellow',
                shape: 'dot',
                text: 'pairing code ' + (codes ? codes.manualPairingCode : '?') + suffix,
            };
        }

        case 'starting':
            return {fill: 'yellow', shape: 'ring', text: 'starting' + suffix};
        case 'offline':
        case 'stopped':
            return {fill: 'grey', shape: 'ring', text: 'offline' + suffix};
        default:
            return {fill: 'grey', shape: 'ring', text: 'waiting for bridge' + suffix};
    }
}

/**
 * Keep a node's status in sync with its bridge. Returns a function that
 * removes the listeners again (call it on close).
 */
function trackBridge(node, bridge, detail = () => undefined) {
    const update = () => node.status(bridgeStatus(bridge, detail()));
    const events = ['online', 'offline', 'error', 'fabricsChanged'];
    for (const event of events) {
        bridge.on(event, update);
    }

    update();
    const remove = () => {
        for (const event of events) {
            bridge.off(event, update);
        }
    };

    remove.update = update;
    return remove;
}

module.exports = {bridgeStatus, trackBridge};
