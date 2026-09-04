/* Button presses on a GenericSwitch endpoint. matter.js' SwitchServer
   derives the Matter events from `currentPosition` transitions: 1 → 0 within
   `longPressDelay` is a short press (initialPress, shortRelease,
   multiPressComplete), holding past `longPressDelay` a long press
   (longPress, longRelease), a second press within `multiPressDelay` a
   double press (multiPressComplete with count 2). One press at a time per
   endpoint; presses queue. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queues = new WeakMap();

/**
 * @param {import('./matter').Device} device  a genericSwitch device
 * @param {'short'|'long'|'double'} kind
 * @param {{longPressDelay?: number, multiPressDelay?: number, pressTime?: number}} [timing]
 */
function press(device, kind, timing = {}) {
    const state = (device.state && device.state.switch) || {};
    const longPressDelay = timing.longPressDelay || state.longPressDelay || 800;
    const multiPressDelay = timing.multiPressDelay || state.multiPressDelay || 400;
    const pressTime = timing.pressTime || 50;

    const run = async () => {
        const down = () => device.set({switch: {currentPosition: 1}});
        const up = () => device.set({switch: {currentPosition: 0}});
        switch (kind) {
            case 'long':
                await down();
                await sleep(longPressDelay + 100);
                await up();
                break;
            case 'double':
                await down();
                await sleep(pressTime);
                await up();
                await sleep(Math.min(pressTime, multiPressDelay / 2));
                await down();
                await sleep(pressTime);
                await up();
                break;
            default:
                await down();
                await sleep(pressTime);
                await up();
        }

        // let the multi-press window close before the next press starts
        await sleep(multiPressDelay + 50);
    };

    const previous = queues.get(device) || Promise.resolve();
    const next = previous.then(run, run);
    queues.set(device, next);
    return next;
}

/** 'short' | 'long' | 'double' from a topic suffix like "1/long" */
function kindOf(text) {
    const s = String(text || '').toLowerCase();
    if (/long/.test(s)) {
        return 'long';
    }

    if (/double|twice|2/.test(s)) {
        return 'double';
    }

    return 'short';
}

module.exports = {press, kindOf};
