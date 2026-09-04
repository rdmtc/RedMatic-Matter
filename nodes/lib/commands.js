/* Command hooks (ROADMAP task 7, `commands.js`): the clusters Matter drives
   by command rather than by attribute write get behaviour subclasses whose
   command handlers notify the endpoint's handler before matter.js' default
   implementation runs. Attribute-driven clusters (OnOff, LevelControl,
   ColorControl, FanControl, Thermostat setpoints) need no hook: a remote
   command changes the attribute and the `$Changed` event carries the actor
   context.

   Handlers are registered per matter.js Endpoint (`setHandler(endpoint,
   fn)`); `fn(command, request)` where command is `<cluster>/<name>`, e.g.
   `doorLock/lockDoor`, `windowCovering/stopMotion`, `identify/identify`.

   Every override acquires the behaviour's state lock asynchronously first
   (the pattern matter.js' own behaviours use): the default command
   implementations write state synchronously and throw "Cannot lock ...
   synchronously" when a `set()` of ours — a CCU event a few milliseconds
   earlier — still holds the lock. */

const {DoorLockServer: BaseDoorLockServer} = require('@matter/main/behaviors/door-lock');
const {WindowCoveringServer: BaseWindowCoveringServer} = require('@matter/main/behaviors/window-covering');
const {ThermostatServer: BaseThermostatServer} = require('@matter/main/behaviors/thermostat');
const {IdentifyServer: BaseIdentifyServer} = require('@matter/main/behaviors/identify');

const handlers = new WeakMap();

function setHandler(endpoint, fn) {
    if (fn) {
        handlers.set(endpoint, fn);
    } else {
        handlers.delete(endpoint);
    }
}

function notify(behavior, command, request) {
    const fn = handlers.get(behavior.endpoint);
    if (fn) {
        try {
            fn(command, request === undefined ? {} : request, behavior.context);
        } catch (error) {
            // a failing handler must not break the Matter transaction
            console.error('redmatic-matter command handler failed: ' + error.message);
        }
    }
}

/** wait for the state lock instead of letting the default implementation fail synchronously */
async function lock(behavior) {
    const {transaction} = behavior.context;
    await transaction.addResources(behavior);
    await transaction.begin();
}

class DoorLockServer extends BaseDoorLockServer.with() {
    async lockDoor(request) {
        notify(this, 'doorLock/lockDoor', request);
        await lock(this);
        return super.lockDoor(request);
    }

    async unlockDoor(request) {
        notify(this, 'doorLock/unlockDoor', request);
        await lock(this);
        return super.unlockDoor(request);
    }
}

function windowCoveringServer(...features) {
    return class WindowCoveringServer extends BaseWindowCoveringServer.with(...features) {
        async upOrOpen() {
            notify(this, 'windowCovering/upOrOpen');
            await lock(this);
            return super.upOrOpen();
        }

        async downOrClose() {
            notify(this, 'windowCovering/downOrClose');
            await lock(this);
            return super.downOrClose();
        }

        async stopMotion() {
            notify(this, 'windowCovering/stopMotion');
            await lock(this);
            return super.stopMotion();
        }

        async goToLiftPercentage(request) {
            notify(this, 'windowCovering/goToLiftPercentage', request);
            await lock(this);
            return super.goToLiftPercentage(request);
        }

        async goToTiltPercentage(request) {
            notify(this, 'windowCovering/goToTiltPercentage', request);
            await lock(this);
            return super.goToTiltPercentage(request);
        }

        /**
         * matter.js' default implementation moves the covering instantly
         * (current = target); a bridged device reports its real position
         * through the current* attributes instead, so nothing happens here.
         */
        handleMovement() {}
    };
}

const WindowCoveringLiftServer = windowCoveringServer('Lift', 'PositionAwareLift');
const WindowCoveringTiltServer = windowCoveringServer('Lift', 'PositionAwareLift', 'Tilt', 'PositionAwareTilt');

class ThermostatServer extends BaseThermostatServer.with('Heating') {
    async setpointRaiseLower(request) {
        notify(this, 'thermostat/setpointRaiseLower', request);
        await lock(this);
        return super.setpointRaiseLower(request);
    }
}

class IdentifyServer extends BaseIdentifyServer {
    async identify(request) {
        notify(this, 'identify/identify', request);
        await lock(this);
        return super.identify(request);
    }
}

module.exports = {
    setHandler,
    DoorLockServer,
    WindowCoveringLiftServer,
    WindowCoveringTiltServer,
    ThermostatServer,
    IdentifyServer,
};
