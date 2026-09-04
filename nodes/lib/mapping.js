/* Homematic channel → Matter endpoint mapping (ROADMAP task 10, D-6).

   Pure functions over (device description, paramset descriptions, options):
   `plan()` turns the channel roles of lib/roles.js into endpoint plans that
   name a device type of lib/devices.js, the datapoints to subscribe, how a
   datapoint value becomes an attribute patch, how a controller's attribute
   write or command becomes CCU writes, and what the editor offers. The
   runtime (lib/hm-device.js) executes plans, the catalogue (lib/catalogue.js)
   renders them; neither knows Homematic semantics.

   Conversions (Matter units): temperature and humidity in 1/100, levels
   1..254, lift/tilt in percent100ths with 0 = open and 10000 = closed
   (Homematic LEVEL 1 = open), illuminance 10000·log10(lux)+1, hue 0..254,
   saturation 0..254, colour temperature in mireds. */

const roles = require('./roles');
const {stateDatapoint} = require('./state-source');

/** editor choices per role (first = default) */
const SWITCH_TYPES = ['Plug-in unit', 'Light'];
const BLIND_TYPES = ['With tilt', 'Without tilt'];

/** device types that map fine but are noise for most homes (the CCU's virtual remote) */
const OPT_IN_TYPES = /^(HmIP|HM)-RCV-50$/i;

function isOptIn(device) {
    return Boolean(device && OPT_IN_TYPES.test(String(device.TYPE)));
}

/** roles this package has no Matter equivalent for, with the reason shown in the list */
const UNSUPPORTED_ROLES = {
    garage: 'garage doors stay on RedMatic-HomeKit (no controller renders Matter’s Closure type)',
    energy: 'energy measurement follows after 1.0.0',
};

function opt(options, address) {
    return (options && options[address]) || {};
}

/** index of an ENUM value name, or the fallback when the description is unknown */
function enumIndex(description, name, fallback) {
    const list = description && description.VALUE_LIST;
    if (Array.isArray(list)) {
        const index = list.indexOf(name);
        if (index !== -1) {
            return index;
        }
    }

    return fallback;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = Math.round;

const convert = {
    /** Homematic 0..1 → Matter level 1..254 */
    levelToMatter: (level) => clamp(round(Number(level) * 253) + 1, 1, 254),
    /** Matter level 1..254 → Homematic 0..1 */
    levelToHm: (level) => clamp(round(((Number(level) - 1) / 253) * 100) / 100, 0, 1),
    /** Homematic 0..1 (1 = open) → percent100ths (0 = open) */
    positionToMatter: (level) => clamp(round((1 - Number(level)) * 10000), 0, 10000),
    positionToHm: (percent100ths) => clamp(round((1 - Number(percent100ths) / 10000) * 100) / 100, 0, 1),
    temperature: (celsius) => (celsius === null || celsius === undefined ? null : round(Number(celsius) * 100)),
    humidity: (percent) =>
        percent === null || percent === undefined ? null : clamp(round(Number(percent) * 100), 0, 10000),
    illuminance: (lux) => {
        const v = Number(lux);
        if (!(v > 0)) {
            return 0;
        }

        return clamp(round(10000 * Math.log10(v) + 1), 1, 0xfffe);
    },
    hueToMatter: (degrees) => clamp(round((Number(degrees) / 360) * 254), 0, 254),
    hueToHm: (hue) => clamp(round((Number(hue) / 254) * 360), 0, 360),
    saturationToMatter: (fraction) => clamp(round(Number(fraction) * 254), 0, 254),
    saturationToHm: (saturation) => clamp(round((Number(saturation) / 254) * 100) / 100, 0, 1),
    kelvinToMireds: (kelvin) => clamp(round(1000000 / Math.max(1, Number(kelvin))), 153, 500),
    miredsToKelvin: (mireds) => round(1000000 / Math.max(1, Number(mireds))),
    /**
     * Battery percentage from the operating voltage; the cell count is read
     * off the value itself (1 cell ≤ 1.7 V, 2 cells ≤ 3.4 V, 3 cells ≤ 5 V,
     * else 4), each cell 1.0 V empty .. 1.5 V full. Matter wants 0..200.
     */
    batteryPercent: (voltage) => {
        const v = Number(voltage);
        if (!(v > 0)) {
            return null;
        }

        const cells = v <= 1.7 ? 1 : v <= 3.4 ? 2 : v <= 5 ? 3 : 4;
        return clamp(round(((v / cells - 1) / 0.5) * 200), 0, 200);
    },
    co2Quality: (ppm) => {
        const v = Number(ppm);
        if (!(v >= 0)) {
            return 0; // Unknown
        }

        return v < 800 ? 1 : v < 1000 ? 2 : v < 1400 ? 3 : v < 2000 ? 4 : v < 5000 ? 5 : 6;
    },
};

/**
 * Everything the runtime and the editor need to know about one device.
 * @param {object} device  device description (TYPE, ADDRESS, CHILDREN)
 * @param {object} ccu  ccu-connection node (metadata, channelNames, getParamsetDescription)
 * @param {string} iface
 * @param {object} [options]  the per-address config of the homematic node
 * @param {object} [channelModes]  CHANNEL_OPERATION_MODE per multi-mode input address
 */
function plan(device, ccu, iface, options = {}, channelModes = {}) {
    const devices = (ccu.metadata && ccu.metadata.devices && ccu.metadata.devices[iface]) || {};
    const getChannel = (address) => devices[address];
    const getValues = (channel) => ccu.getParamsetDescription(iface, channel, 'VALUES');
    const getMode = (address) => channelModes[address];
    const channels = roles.deviceRoles(device, getChannel, getValues, getMode).map((c) => ({
        ...c,
        name: (ccu.channelNames && ccu.channelNames[c.address]) || c.address,
        values: getValues(getChannel(c.address)) || {},
        config: opt(options, c.address),
    }));

    const maintenance = channels.find((c) => c.role === 'maintenance');
    const maintenanceValues = maintenance ? maintenance.values : {};
    const lowbat = ['LOW_BAT', 'LOWBAT'].find((dp) => maintenanceValues[dp]) || null;
    const voltage = maintenanceValues.OPERATING_VOLTAGE ? 'OPERATING_VOLTAGE' : null;
    const unreach = maintenanceValues.UNREACH ? 'UNREACH' : null;
    const maintenanceAddress = maintenance ? maintenance.address : device.ADDRESS + ':0';
    const usable = channels.filter((c) => c.role && c.role !== 'maintenance' && c.role !== 'state_only');
    const actuators = usable.filter((c) => c.actuator && !c.virtual);
    const deviceOptions = opt(options, device.ADDRESS);

    // BidCos reports LOWBAT on every device, mains actuators included; HmIP only on battery devices
    const batteryPossible = Boolean(lowbat) && (iface !== 'BidCos-RF' || actuators.length === 0);
    const battery = batteryPossible && !opt(options, device.ADDRESS + ':Battery').disabled;
    const dp = (address, datapoint) => iface + '.' + address + '.' + datapoint;
    const read = (address, datapoint) => stateDatapoint(ccu, dp(address, datapoint));

    const result = {
        address: device.ADDRESS,
        type: device.TYPE,
        firmware: device.FIRMWARE,
        iface,
        name: (ccu.channelNames && ccu.channelNames[device.ADDRESS]) || device.ADDRESS,
        optIn: isOptIn(device),
        enabled: Boolean(deviceOptions.enabled),
        maintenanceAddress,
        lowbat,
        voltage,
        unreach,
        batteryPossible,
        battery,
        options: [],
        endpoints: [],
        unsupported: [],
        supported: false,
    };

    if (batteryPossible) {
        result.options.push('Battery');
    }

    const ctx = {iface, dp, read, device, plan: result, options, deviceOptions};
    let keyCount = 0;
    for (const c of usable) {
        if (UNSUPPORTED_ROLES[c.role]) {
            result.unsupported.push({
                address: c.address,
                name: c.name,
                type: c.type,
                role: c.role,
                reason: UNSUPPORTED_ROLES[c.role],
            });
            continue;
        }

        const endpoints = endpointsFor(c, ctx);
        if (endpoints.length === 0) {
            result.unsupported.push({
                address: c.address,
                name: c.name,
                type: c.type,
                role: c.role,
                reason: 'no Matter equivalent',
            });
            continue;
        }

        // buttons on an actuator are opt-in like virtual receivers
        const optIn = c.virtual || (c.role === 'key' && actuators.length > 0);
        for (const e of endpoints) {
            e.optIn = optIn;
            e.enabled = optIn ? Boolean(c.config.enabled) : !c.config.disabled;
            if (c.role === 'key') {
                keyCount++;
            }

            result.endpoints.push(e);
        }
    }

    for (const name of ['Humidity', 'Illuminance', 'OpenOnUnlock', 'Boost']) {
        if (
            result.endpoints.some((e) => e.deviceOptions && e.deviceOptions.includes(name)) &&
            !result.options.includes(name)
        ) {
            result.options.push(name);
        }
    }

    // the battery lives on every endpoint of the device (maintainer 2026-09-04:
    // a remote's buttons each show it, a controller never has to look elsewhere)
    if (battery) {
        for (const e of result.endpoints) {
            e.typeOptions.battery = true;
            e.battery = true;
        }
    }

    result.keyCount = keyCount;
    result.supported = result.endpoints.length > 0;
    return result;
}

/**
 * Endpoint plans of one channel. Each plan:
 *   {address, index, role, name, type, typeOptions, state, dropdowns,
 *    deviceOptions, subscriptions: [{datapoint, cache, change, stable, handler}],
 *    writes: [{cluster, attribute, handler}], commands: [{command, handler}]}
 * `handler(value, msg, api)` of a subscription returns an attribute patch or
 * null; `handler(value, meta, api)` of a write / command returns an array of
 * {address, datapoint, value} (or a {defer} instruction, see hm-device.js).
 */
function endpointsFor(c, ctx) {
    const {dp, read, options, plan: p} = ctx;
    const d = c.datapoints;
    const deviceOn = (name) => !opt(options, p.address + ':' + name).disabled;
    const base = (type, extra = {}) => ({
        address: c.address,
        index: c.index,
        role: c.role,
        name: c.name,
        channelType: c.type,
        type,
        typeOptions: {},
        state: {},
        dropdowns: null,
        deviceOptions: [],
        subscriptions: [],
        writes: [],
        commands: [],
        ...extra,
    });

    switch (c.role) {
        case 'switch':
        case 'valve': {
            const light = c.role === 'switch' && c.config.type === 'Light';
            const e = base(light ? 'onOffLight' : 'onOffPlugInUnit', {
                dropdowns: c.role === 'switch' ? {type: SWITCH_TYPES} : null,
            });
            e.subscriptions.push({
                datapoint: read(c.address, d.state),
                handler: (value) => ({onOff: {onOff: Boolean(value)}}),
            });
            e.writes.push({
                cluster: 'onOff',
                attribute: 'onOff',
                handler: (value) => [{address: c.address, datapoint: d.state, value: Boolean(value)}],
            });
            return [e];
        }

        case 'dimmer':
        case 'light_color': {
            const hue = c.role === 'light_color' && d.hue;
            const ct = c.role === 'light_color' && d.colorTemperature;
            const type = hue ? 'extendedColorLight' : ct ? 'colorTemperatureLight' : 'dimmableLight';
            const e = base(type);
            const levelDp = read(c.address, d.level);
            e.subscriptions.push({
                datapoint: levelDp,
                handler: (value, msg, api) => {
                    const level = Number(value);
                    if (level > 0) {
                        api.remember('level', level);
                        return {onOff: {onOff: true}, levelControl: {currentLevel: convert.levelToMatter(level)}};
                    }

                    return {onOff: {onOff: false}};
                },
            });
            e.writes.push({
                cluster: 'onOff',
                attribute: 'onOff',
                handler: (value, meta, api) => {
                    if (!value) {
                        return [{address: c.address, datapoint: d.level, value: 0}];
                    }

                    // "on" without a level: restore the last level unless a level
                    // write follows within the window (voice assistants send both)
                    const current = api.current(levelDp);
                    if (current && Number(current.value) > 0) {
                        return null;
                    }

                    const restore = api.recall('level') || 1;
                    return {defer: 'on', writes: [{address: c.address, datapoint: d.level, value: restore}]};
                },
            });
            e.writes.push({
                cluster: 'levelControl',
                attribute: 'currentLevel',
                handler: (value, meta, api) => {
                    // a Homematic dimmer switches on with any level > 0, which is what
                    // moveToLevelWithOnOff means; the pending bare "on" is superseded
                    const level = convert.levelToHm(value);
                    api.remember('level', level);
                    api.cancel('on');
                    return [{address: c.address, datapoint: d.level, value: level}];
                },
            });
            if (hue) {
                e.subscriptions.push({
                    datapoint: read(c.address, d.hue),
                    handler: (value) => ({
                        colorControl: {currentHue: convert.hueToMatter(value), colorMode: 0, enhancedColorMode: 0},
                    }),
                });
                e.writes.push({
                    cluster: 'colorControl',
                    attribute: 'currentHue',
                    handler: (value) => [{address: c.address, datapoint: d.hue, value: convert.hueToHm(value)}],
                });
                if (d.saturation) {
                    e.subscriptions.push({
                        datapoint: read(c.address, d.saturation),
                        handler: (value) => ({colorControl: {currentSaturation: convert.saturationToMatter(value)}}),
                    });
                    e.writes.push({
                        cluster: 'colorControl',
                        attribute: 'currentSaturation',
                        handler: (value) => [
                            {address: c.address, datapoint: d.saturation, value: convert.saturationToHm(value)},
                        ],
                    });
                }
            }

            if (ct) {
                e.subscriptions.push({
                    datapoint: read(c.address, d.colorTemperature),
                    handler: (value) => ({
                        colorControl: {
                            colorTemperatureMireds: convert.kelvinToMireds(value),
                            colorMode: 2,
                            enhancedColorMode: 2,
                        },
                    }),
                });
                e.writes.push({
                    cluster: 'colorControl',
                    attribute: 'colorTemperatureMireds',
                    handler: (value) => [
                        {address: c.address, datapoint: d.colorTemperature, value: convert.miredsToKelvin(value)},
                    ],
                });
            }

            return [e];
        }

        case 'blind_hmip':
        case 'shutter_hmip':
        case 'blind':
        case 'jalousie':
        case 'window': {
            const tiltPossible = Boolean(d.tilt);
            const tilt = tiltPossible && c.config.type !== 'Without tilt';
            const e = base('windowCovering', {
                typeOptions: {tilt},
                dropdowns: tiltPossible ? {type: BLIND_TYPES} : null,
            });
            const levelDp = read(c.address, d.level);
            e.subscriptions.push({
                datapoint: levelDp,
                stable: false,
                handler: (value, msg) => {
                    const position = convert.positionToMatter(value);
                    const patch = {windowCovering: {currentPositionLiftPercent100ths: position}};
                    // when the drive reports "stable" the target is wherever it stopped
                    if (msg && msg.working === false) {
                        patch.windowCovering.targetPositionLiftPercent100ths = position;
                    }

                    return patch;
                },
            });
            if (tilt) {
                const tiltDp = read(c.address, d.tilt);
                e.subscriptions.push({
                    datapoint: tiltDp,
                    stable: false,
                    handler: (value, msg) => {
                        const position = convert.positionToMatter(value);
                        const patch = {windowCovering: {currentPositionTiltPercent100ths: position}};
                        if (msg && msg.working === false) {
                            patch.windowCovering.targetPositionTiltPercent100ths = position;
                        }

                        return patch;
                    },
                });
            }

            const activity = d.activity
                ? read(c.address, d.activity)
                : d.direction
                  ? read(c.address, d.direction)
                  : null;
            if (activity) {
                // HmIP ACTIVITY_STATE UNKNOWN/UP/DOWN/STABLE, BidCos DIRECTION NONE/UP/DOWN/UNDEFINED
                const up = enumIndex(c.values[d.activity || d.direction], 'UP', 1);
                const down = enumIndex(c.values[d.activity || d.direction], 'DOWN', 2);
                e.subscriptions.push({
                    datapoint: activity,
                    stable: false,
                    handler: (value, msg, api) => {
                        const moving = value === up || value === down;
                        if (moving) {
                            return null;
                        }

                        // stopped: the current position becomes the target
                        const current = api.state();
                        const wc = current && current.windowCovering;
                        if (!wc) {
                            return null;
                        }

                        const patch = {
                            windowCovering: {targetPositionLiftPercent100ths: wc.currentPositionLiftPercent100ths},
                        };
                        if (tilt) {
                            patch.windowCovering.targetPositionTiltPercent100ths = wc.currentPositionTiltPercent100ths;
                        }

                        return patch;
                    },
                });
            }

            const lift = (percent100ths) => [
                {address: c.address, datapoint: d.level, value: convert.positionToHm(percent100ths)},
            ];
            e.commands.push({command: 'windowCovering/upOrOpen', handler: () => lift(0)});
            e.commands.push({command: 'windowCovering/downOrClose', handler: () => lift(10000)});
            e.commands.push({
                command: 'windowCovering/goToLiftPercentage',
                handler: (request) => lift(request.liftPercent100thsValue),
            });
            if (c.values.STOP) {
                e.commands.push({
                    command: 'windowCovering/stopMotion',
                    handler: () => [{address: c.address, datapoint: 'STOP', value: true}],
                });
            }
            if (tilt) {
                e.commands.push({
                    command: 'windowCovering/goToTiltPercentage',
                    handler: (request) => [
                        {
                            address: c.address,
                            datapoint: d.tilt,
                            value: convert.positionToHm(request.tiltPercent100thsValue),
                        },
                    ],
                });
            }

            return [e];
        }

        case 'contact':
        case 'rotary_handle': {
            const description = c.values[d.state];
            const closed = description && description.TYPE === 'ENUM' ? enumIndex(description, 'CLOSED', 0) : false;
            const e = base('contactSensor');
            e.subscriptions.push({
                datapoint: dp(c.address, d.state),
                // Matter: true = closed
                handler: (value) => ({booleanState: {stateValue: closed === false ? !value : value === closed}}),
            });
            return [e];
        }

        case 'motion':
        case 'presence': {
            const luxDp = d.illumination && d.illumination !== 'BRIGHTNESS' ? d.illumination : null;
            const illuminance = Boolean(luxDp) && deviceOn('Illuminance');
            const e = base('occupancySensor', {
                typeOptions: {illuminance},
                deviceOptions: luxDp ? ['Illuminance'] : [],
            });
            e.subscriptions.push({
                datapoint: dp(c.address, d.state),
                handler: (value) => ({occupancySensing: {occupancy: {occupied: Boolean(value)}}}),
            });
            if (illuminance) {
                e.subscriptions.push({
                    datapoint: dp(c.address, luxDp),
                    handler: (value) => ({illuminanceMeasurement: {measuredValue: convert.illuminance(value)}}),
                });
            }

            return [e];
        }

        case 'smoke': {
            const e = base('smokeCoAlarm');
            const description = c.values[d.state];
            const primary = enumIndex(description, 'PRIMARY_ALARM', 1);
            e.subscriptions.push({
                datapoint: dp(c.address, d.state),
                handler: (value) => {
                    const alarm = typeof value === 'boolean' ? value : value === primary;
                    return {smokeCoAlarm: {smokeState: alarm ? 2 : 0, expressedState: alarm ? 1 : 0}};
                },
            });
            return [e];
        }

        case 'water':
        case 'rain': {
            const e = base(c.role === 'water' ? 'waterLeakDetector' : 'rainSensor');
            e.subscriptions.push({
                datapoint: dp(c.address, d.state),
                handler: (value) => ({booleanState: {stateValue: Boolean(value)}}),
            });
            return [e];
        }

        case 'co2': {
            const e = base('airQualitySensor');
            e.subscriptions.push({
                datapoint: dp(c.address, d.level),
                handler: (value) => ({
                    airQuality: {airQuality: convert.co2Quality(value)},
                    carbonDioxideConcentrationMeasurement: {measuredValue: Number(value)},
                }),
            });
            return [e];
        }

        case 'weather':
        case 'humidity':
        case 'light_sensor': {
            const endpoints = [];
            if (d.temperature) {
                const humidity = Boolean(d.humidity) && deviceOn('Humidity');
                const illuminance = Boolean(d.illumination) && deviceOn('Illuminance');
                const e = base('temperatureSensor', {
                    typeOptions: {humidity, illuminance},
                    deviceOptions: [...(d.humidity ? ['Humidity'] : []), ...(d.illumination ? ['Illuminance'] : [])],
                });
                e.subscriptions.push({
                    datapoint: dp(c.address, d.temperature),
                    handler: (value) => ({temperatureMeasurement: {measuredValue: convert.temperature(value)}}),
                });
                if (humidity) {
                    e.subscriptions.push({
                        datapoint: dp(c.address, d.humidity),
                        handler: (value) => ({relativeHumidityMeasurement: {measuredValue: convert.humidity(value)}}),
                    });
                }

                if (illuminance) {
                    e.subscriptions.push({
                        datapoint: dp(c.address, d.illumination),
                        handler: (value) => ({illuminanceMeasurement: {measuredValue: convert.illuminance(value)}}),
                    });
                }

                endpoints.push(e);
            } else if (d.humidity) {
                const e = base('humiditySensor');
                e.subscriptions.push({
                    datapoint: dp(c.address, d.humidity),
                    handler: (value) => ({relativeHumidityMeasurement: {measuredValue: convert.humidity(value)}}),
                });
                endpoints.push(e);
            } else if (d.illumination) {
                const e = base('lightSensor');
                e.subscriptions.push({
                    datapoint: dp(c.address, d.illumination),
                    handler: (value) => ({illuminanceMeasurement: {measuredValue: convert.illuminance(value)}}),
                });
                endpoints.push(e);
            }

            return endpoints;
        }

        case 'key': {
            if (!d.short && !d.long) {
                return [];
            }

            // the CCU already applied its long-press threshold: report the
            // long press quickly instead of waiting matter.js' default 800 ms
            const e = base('genericSwitch', {state: {switch: {longPressDelay: 300}}});
            // an input in "Schalter" mode sends one short press per flip, never a long one
            const long = c.mode === 'SWITCH_BEHAVIOR' ? null : d.long || null;
            e.keys = {
                short: d.short ? dp(c.address, d.short) : null,
                long: long ? dp(c.address, long) : null,
                release: long && c.values.PRESS_LONG_RELEASE ? dp(c.address, 'PRESS_LONG_RELEASE') : null,
                reportUsage: [d.short, long].filter(Boolean),
            };
            return [e];
        }

        case 'lock_hmip': {
            const e = base('doorLock', {deviceOptions: ['OpenOnUnlock']});
            const locked = enumIndex(c.values[d.state], 'LOCKED', 1);
            const unlocked = enumIndex(c.values[d.state], 'UNLOCKED', 2);
            const targetLocked = enumIndex(c.values[d.target], 'LOCKED', 0);
            const targetUnlocked = enumIndex(c.values[d.target], 'UNLOCKED', 1);
            const targetOpen = enumIndex(c.values[d.target], 'OPEN', 2);
            const openOnUnlock = deviceOn('OpenOnUnlock');
            e.subscriptions.push({
                datapoint: dp(c.address, d.state),
                handler: (value) => ({doorLock: {lockState: value === locked ? 1 : value === unlocked ? 2 : 0}}),
            });
            e.commands.push({
                command: 'doorLock/lockDoor',
                handler: () => [{address: c.address, datapoint: d.target, value: targetLocked}],
            });
            e.commands.push({
                command: 'doorLock/unlockDoor',
                handler: () => [
                    {address: c.address, datapoint: d.target, value: openOnUnlock ? targetOpen : targetUnlocked},
                ],
            });
            return [e];
        }

        case 'lock': {
            // KeyMatic: STATE true = unlocked, OPEN pulls the latch
            const e = base('doorLock', {deviceOptions: d.open ? ['OpenOnUnlock'] : []});
            const openOnUnlock = Boolean(d.open) && deviceOn('OpenOnUnlock');
            e.subscriptions.push({
                datapoint: dp(c.address, d.state),
                handler: (value) => ({doorLock: {lockState: value ? 2 : 1}}),
            });
            e.commands.push({
                command: 'doorLock/lockDoor',
                handler: () => [{address: c.address, datapoint: d.state, value: false}],
            });
            e.commands.push({
                command: 'doorLock/unlockDoor',
                handler: () =>
                    openOnUnlock
                        ? [{address: c.address, datapoint: d.open, value: true}]
                        : [{address: c.address, datapoint: d.state, value: true}],
            });
            return [e];
        }

        case 'lock_state': {
            // sensor only (HmIP-DLS): the lock state is shown, commands are answered with the real state
            const e = base('doorLock');
            const locked = enumIndex(c.values[d.state], 'LOCKED', 1);
            const unlocked = enumIndex(c.values[d.state], 'UNLOCKED', 2);
            const stateDp = dp(c.address, d.state);
            const toState = (value) => (value === locked ? 1 : value === unlocked ? 2 : 0);
            e.subscriptions.push({datapoint: stateDp, handler: (value) => ({doorLock: {lockState: toState(value)}})});
            const reassert = (request, api) => {
                api.later(100, () => {
                    const current = api.current(stateDp);
                    if (current) {
                        api.set({doorLock: {lockState: toState(current.value)}});
                    }
                });
                return null;
            };

            e.commands.push({command: 'doorLock/lockDoor', handler: reassert});
            e.commands.push({command: 'doorLock/unlockDoor', handler: reassert});
            return [e];
        }

        case 'thermostat_hmip':
        case 'thermostat_hm': {
            const OFF = 4.5;
            const humidity = Boolean(d.humidity) && deviceOn('Humidity');
            const e = base('thermostat', {
                typeOptions: {humidity},
                deviceOptions: [...(d.humidity ? ['Humidity'] : []), ...(d.boost ? ['Boost'] : [])],
            });
            const setpointDp = dp(c.address, d.setpoint);
            if (d.temperature) {
                e.subscriptions.push({
                    datapoint: dp(c.address, d.temperature),
                    handler: (value) => ({thermostat: {localTemperature: convert.temperature(value)}}),
                });
            }

            e.subscriptions.push({
                datapoint: setpointDp,
                handler: (value, msg, api) => {
                    const setpoint = Number(value);
                    if (setpoint > OFF) {
                        api.remember('setpoint', setpoint);
                        return {thermostat: {occupiedHeatingSetpoint: convert.temperature(setpoint), systemMode: 4}};
                    }

                    return {thermostat: {systemMode: 0}};
                },
            });
            e.writes.push({
                cluster: 'thermostat',
                attribute: 'occupiedHeatingSetpoint',
                handler: (value, meta, api) => {
                    const setpoint = clamp(round(Number(value) / 50) / 2, OFF, 30.5);
                    api.remember('setpoint', setpoint);
                    return [{address: c.address, datapoint: d.setpoint, value: setpoint}];
                },
            });
            e.writes.push({
                cluster: 'thermostat',
                attribute: 'systemMode',
                handler: (value, meta, api) => {
                    if (Number(value) === 0) {
                        return [{address: c.address, datapoint: d.setpoint, value: OFF}];
                    }

                    const current = api.current(setpointDp);
                    if (current && Number(current.value) > OFF) {
                        return null;
                    }

                    return [{address: c.address, datapoint: d.setpoint, value: api.recall('setpoint') || 21}];
                },
            });
            if (humidity) {
                e.subscriptions.push({
                    datapoint: dp(c.address, d.humidity),
                    handler: (value) => ({relativeHumidityMeasurement: {measuredValue: convert.humidity(value)}}),
                });
            }

            const endpoints = [e];
            if (d.boost && deviceOn('Boost') && opt(options, p.address + ':Boost').enabled) {
                const boost = base('onOffPlugInUnit', {
                    address: c.address + ':Boost',
                    name: c.name + ' Boost',
                    role: 'boost',
                });
                boost.subscriptions.push({
                    datapoint: dp(c.address, d.boost),
                    handler: (value) => ({onOff: {onOff: Boolean(value)}}),
                });
                boost.writes.push({
                    cluster: 'onOff',
                    attribute: 'onOff',
                    handler: (value) => [{address: c.address, datapoint: d.boost, value: Boolean(value)}],
                });
                endpoints.push(boost);
            }

            return endpoints;
        }

        default:
            return [];
    }
}

/**
 * Battery and reachability of a device, applied to its endpoints by the runtime.
 * @returns {{subscriptions: Array}} datapoint subscriptions with handlers returning patches for the carrier endpoint
 */
function maintenancePlan(p) {
    const iface = p.iface;
    const dp = (datapoint) => iface + '.' + p.maintenanceAddress + '.' + datapoint;
    const subscriptions = [];
    if (p.battery && p.lowbat) {
        subscriptions.push({
            datapoint: dp(p.lowbat),
            target: 'battery',
            handler: (value) => ({powerSource: {batChargeLevel: value ? 2 : 0, batReplacementNeeded: Boolean(value)}}),
        });
    }

    if (p.battery && p.voltage) {
        subscriptions.push({
            datapoint: dp(p.voltage),
            target: 'battery',
            handler: (value) => ({powerSource: {batPercentRemaining: convert.batteryPercent(value)}}),
        });
    }

    if (p.unreach) {
        subscriptions.push({datapoint: dp(p.unreach), target: 'all', handler: (value) => ({reachable: !value})});
    }

    return {subscriptions};
}

module.exports = {
    plan,
    maintenancePlan,
    endpointsFor,
    isOptIn,
    enumIndex,
    convert,
    SWITCH_TYPES,
    BLIND_TYPES,
    UNSUPPORTED_ROLES,
};
