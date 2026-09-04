/* Matter device types this package can create, with the feature choices and
   the initial attribute values that make matter.js 0.17 endpoints initialise
   at all (Matter 1.4.2 dropped most defaults; six of the types below fail
   without them — ROADMAP task 7, hm2matter M-17). Everything that touches
   device types lives here; nodes and mappers name types as strings.

   `build(name, options)` returns {type, state, key}:
     type   the matter.js EndpointType (device type + behaviours)
     state  initial state for `new Endpoint(type, {..., ...state})`
     key    identity key: the same type name and options give the same key,
            a different shape a different one (endpoint identity rotation,
            ROADMAP D-8)

   Options shared by several types:
     battery: true       PowerSource cluster with the Battery feature
     wired: true         PowerSource cluster with the Wired feature (mains)
     humidity: true      RelativeHumidityMeasurement composed onto the type
     illuminance: true   IlluminanceMeasurement composed onto the type */

// everything from matter.js is required lazily: listing the types for the
// editor must not cost the 1–4 s / 160 MB of loading the library
const dev = (n) => require('@matter/main/devices/' + n);
const beh = (n) => require('@matter/main/behaviors/' + n);
const cl = (n) => require('@matter/main/clusters/' + n);
const commands = new Proxy(
    {},
    {
        get: (_target, name) => require('./commands')[name],
    },
);

// matter.js units: temperature/humidity in 1/100, mireds, percent100ths
const ct = () => ({
    colorTempPhysicalMinMireds: 153,
    colorTempPhysicalMaxMireds: 500,
    colorTemperatureMireds: 300,
    coupleColorTempToLevelMinMireds: 153,
    startUpColorTemperatureMireds: 300,
});

function powerSource(options) {
    const {PowerSourceServer} = beh('power-source');
    const {PowerSource} = cl('power-source');
    if (options.battery) {
        return {
            behaviours: [PowerSourceServer.with('Battery')],
            state: {
                powerSource: {
                    status: PowerSource.PowerSourceStatus.Active,
                    order: 0,
                    description: 'Battery',
                    batChargeLevel: PowerSource.BatChargeLevel.Ok,
                    batReplacementNeeded: false,
                    batReplaceability: PowerSource.BatReplaceability.UserReplaceable,
                    batPercentRemaining: null,
                },
            },
        };
    }

    if (options.wired) {
        return {
            behaviours: [PowerSourceServer.with('Wired')],
            state: {
                powerSource: {
                    status: PowerSource.PowerSourceStatus.Active,
                    order: 0,
                    description: 'Mains',
                    wiredCurrentType: PowerSource.WiredCurrentType.Ac,
                },
            },
        };
    }

    return {behaviours: [], state: {}};
}

function humidity(options) {
    if (!options.humidity) {
        return {behaviours: [], state: {}};
    }

    return {
        behaviours: [beh('relative-humidity-measurement').RelativeHumidityMeasurementServer],
        state: {relativeHumidityMeasurement: {measuredValue: null}},
    };
}

function illuminance(options) {
    if (!options.illuminance) {
        return {behaviours: [], state: {}};
    }

    return {
        behaviours: [beh('illuminance-measurement').IlluminanceMeasurementServer],
        state: {illuminanceMeasurement: {measuredValue: null}},
    };
}

/**
 * The catalogue. `group` orders the universal node's dropdown, `label` is
 * shown there, `attributes` lists the writable/updatable attribute paths a
 * user of the universal node is most likely to need (help text).
 */
const TYPES = {
    onOffPlugInUnit: {
        group: 'Actuators',
        label: 'Plug-in unit (on/off)',
        attributes: ['onOff/onOff'],
        build: () => ({type: dev('on-off-plug-in-unit').OnOffPlugInUnitDevice, state: {onOff: {onOff: false}}}),
    },
    onOffLight: {
        group: 'Lights',
        label: 'Light (on/off)',
        attributes: ['onOff/onOff'],
        build: () => ({type: dev('on-off-light').OnOffLightDevice, state: {onOff: {onOff: false}}}),
    },
    dimmableLight: {
        group: 'Lights',
        label: 'Dimmable light',
        attributes: ['onOff/onOff', 'levelControl/currentLevel (1..254)'],
        build: () => ({
            type: dev('dimmable-light').DimmableLightDevice,
            state: {onOff: {onOff: false}, levelControl: {currentLevel: 1, minLevel: 1, maxLevel: 254, onLevel: null}},
        }),
    },
    colorTemperatureLight: {
        group: 'Lights',
        label: 'Colour temperature light',
        attributes: ['onOff/onOff', 'levelControl/currentLevel', 'colorControl/colorTemperatureMireds (153..500)'],
        build: () => {
            const {ColorControl} = cl('color-control');
            return {
                type: dev('color-temperature-light').ColorTemperatureLightDevice,
                state: {
                    onOff: {onOff: false},
                    levelControl: {currentLevel: 1, minLevel: 1, maxLevel: 254, onLevel: null},
                    colorControl: {
                        colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
                        enhancedColorMode: ColorControl.EnhancedColorMode.ColorTemperatureMireds,
                        ...ct(),
                    },
                },
            };
        },
    },
    extendedColorLight: {
        group: 'Lights',
        label: 'Colour light (hue/saturation + colour temperature)',
        attributes: [
            'onOff/onOff',
            'levelControl/currentLevel',
            'colorControl/currentHue (0..254)',
            'colorControl/currentSaturation (0..254)',
            'colorControl/colorTemperatureMireds',
        ],
        build: () => {
            const {ColorControl} = cl('color-control');
            const {ColorControlServer} = beh('color-control');
            return {
                type: dev('extended-color-light').ExtendedColorLightDevice.with(
                    ColorControlServer.with('HueSaturation', 'ColorTemperature'),
                ),
                state: {
                    onOff: {onOff: false},
                    levelControl: {currentLevel: 1, minLevel: 1, maxLevel: 254, onLevel: null},
                    colorControl: {
                        colorMode: ColorControl.ColorMode.CurrentHueAndCurrentSaturation,
                        enhancedColorMode: ColorControl.EnhancedColorMode.CurrentHueAndCurrentSaturation,
                        currentHue: 0,
                        currentSaturation: 0,
                        ...ct(),
                    },
                },
            };
        },
    },
    contactSensor: {
        group: 'Sensors',
        label: 'Contact sensor',
        attributes: ['booleanState/stateValue (true = closed)'],
        build: () => ({type: dev('contact-sensor').ContactSensorDevice, state: {booleanState: {stateValue: true}}}),
    },
    occupancySensor: {
        group: 'Sensors',
        label: 'Occupancy / motion sensor',
        attributes: ['occupancySensing/occupancy ({occupied: true})'],
        build: () => {
            const {OccupancySensing} = cl('occupancy-sensing');
            return {
                type: dev('occupancy-sensor').OccupancySensorDevice,
                state: {
                    occupancySensing: {
                        occupancy: {occupied: false},
                        occupancySensorType: OccupancySensing.OccupancySensorType.Pir,
                        occupancySensorTypeBitmap: {pir: true},
                    },
                },
            };
        },
    },
    temperatureSensor: {
        group: 'Sensors',
        label: 'Temperature sensor',
        attributes: ['temperatureMeasurement/measuredValue (1/100 °C)'],
        build: () => ({
            type: dev('temperature-sensor').TemperatureSensorDevice,
            state: {temperatureMeasurement: {measuredValue: null}},
        }),
    },
    humiditySensor: {
        group: 'Sensors',
        label: 'Humidity sensor',
        attributes: ['relativeHumidityMeasurement/measuredValue (1/100 %)'],
        build: () => ({
            type: dev('humidity-sensor').HumiditySensorDevice,
            state: {relativeHumidityMeasurement: {measuredValue: null}},
        }),
    },
    lightSensor: {
        group: 'Sensors',
        label: 'Light sensor',
        attributes: ['illuminanceMeasurement/measuredValue (10000·log10(lux)+1)'],
        build: () => ({
            type: dev('light-sensor').LightSensorDevice,
            state: {illuminanceMeasurement: {measuredValue: null}},
        }),
    },
    pressureSensor: {
        group: 'Sensors',
        label: 'Pressure sensor',
        attributes: ['pressureMeasurement/measuredValue (kPa·10)'],
        build: () => ({
            type: dev('pressure-sensor').PressureSensorDevice,
            state: {pressureMeasurement: {measuredValue: null}},
        }),
    },
    flowSensor: {
        group: 'Sensors',
        label: 'Flow sensor',
        attributes: ['flowMeasurement/measuredValue (m³/h·10)'],
        build: () => ({type: dev('flow-sensor').FlowSensorDevice, state: {flowMeasurement: {measuredValue: null}}}),
    },
    smokeCoAlarm: {
        group: 'Sensors',
        label: 'Smoke alarm',
        attributes: ['smokeCoAlarm/smokeState (0 normal, 1 warning, 2 critical)', 'smokeCoAlarm/expressedState'],
        build: () => {
            const {SmokeCoAlarmServer} = beh('smoke-co-alarm');
            const {SmokeCoAlarm} = cl('smoke-co-alarm');
            return {
                type: dev('smoke-co-alarm').SmokeCoAlarmDevice.with(SmokeCoAlarmServer.with('SmokeAlarm')),
                state: {
                    smokeCoAlarm: {
                        expressedState: SmokeCoAlarm.ExpressedState.Normal,
                        smokeState: SmokeCoAlarm.AlarmState.Normal,
                        batteryAlert: SmokeCoAlarm.AlarmState.Normal,
                        testInProgress: false,
                        hardwareFaultAlert: false,
                        endOfServiceAlert: SmokeCoAlarm.EndOfService.Normal,
                    },
                },
            };
        },
    },
    waterLeakDetector: {
        group: 'Sensors',
        label: 'Water leak detector',
        attributes: ['booleanState/stateValue (true = leak)'],
        build: () => ({
            type: dev('water-leak-detector').WaterLeakDetectorDevice,
            state: {booleanState: {stateValue: false}},
        }),
    },
    rainSensor: {
        group: 'Sensors',
        label: 'Rain sensor',
        attributes: ['booleanState/stateValue (true = rain)'],
        build: () => ({type: dev('rain-sensor').RainSensorDevice, state: {booleanState: {stateValue: false}}}),
    },
    airQualitySensor: {
        group: 'Sensors',
        label: 'Air quality sensor (CO₂)',
        attributes: ['airQuality/airQuality (0..6)', 'carbonDioxideConcentrationMeasurement/measuredValue (ppm)'],
        build: () => {
            const {AirQualityServer} = beh('air-quality');
            const {CarbonDioxideConcentrationMeasurementServer} = beh('carbon-dioxide-concentration-measurement');
            const {AirQuality} = cl('air-quality');
            const {ConcentrationMeasurement} = cl('concentration-measurement');
            return {
                type: dev('air-quality-sensor').AirQualitySensorDevice.with(
                    AirQualityServer.with('Fair', 'Moderate', 'VeryPoor', 'ExtremelyPoor'),
                    CarbonDioxideConcentrationMeasurementServer.with('NumericMeasurement'),
                ),
                state: {
                    airQuality: {airQuality: AirQuality.AirQualityEnum.Unknown},
                    carbonDioxideConcentrationMeasurement: {
                        measuredValue: null,
                        minMeasuredValue: 0,
                        maxMeasuredValue: 10000,
                        measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
                        measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
                    },
                },
            };
        },
    },
    thermostat: {
        group: 'Climate',
        label: 'Thermostat (heating)',
        attributes: [
            'thermostat/localTemperature (1/100 °C)',
            'thermostat/occupiedHeatingSetpoint (1/100 °C)',
            'thermostat/systemMode (0 off, 4 heat)',
        ],
        build: () => {
            const {Thermostat} = cl('thermostat');
            return {
                type: dev('thermostat').ThermostatDevice.with(commands.ThermostatServer),
                state: {
                    thermostat: {
                        localTemperature: null,
                        occupiedHeatingSetpoint: 2000,
                        minHeatSetpointLimit: 450,
                        maxHeatSetpointLimit: 3050,
                        absMinHeatSetpointLimit: 450,
                        absMaxHeatSetpointLimit: 3050,
                        systemMode: Thermostat.SystemMode.Heat,
                        controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.HeatingOnly,
                    },
                },
            };
        },
    },
    windowCovering: {
        group: 'Actuators',
        label: 'Window covering (blind, shutter)',
        attributes: [
            'windowCovering/currentPositionLiftPercent100ths (0 open .. 10000 closed)',
            'windowCovering/currentPositionTiltPercent100ths (option tilt)',
        ],
        build: (options) => {
            const {WindowCovering} = cl('window-covering');
            const tilt = Boolean(options.tilt);
            const state = {
                windowCovering: {
                    type: tilt
                        ? WindowCovering.WindowCoveringType.TiltBlindLift
                        : WindowCovering.WindowCoveringType.Rollershade,
                    endProductType: tilt
                        ? WindowCovering.EndProductType.InteriorBlind
                        : WindowCovering.EndProductType.RollerShade,
                    configStatus: {
                        operational: true,
                        onlineReserved: true,
                        liftMovementReversed: false,
                        liftPositionAware: true,
                        tiltPositionAware: tilt,
                        liftEncoderControlled: false,
                        tiltEncoderControlled: false,
                    },
                    currentPositionLiftPercent100ths: 0,
                    targetPositionLiftPercent100ths: 0,
                },
            };
            if (tilt) {
                state.windowCovering.currentPositionTiltPercent100ths = 0;
                state.windowCovering.targetPositionTiltPercent100ths = 0;
            }

            return {
                type: dev('window-covering').WindowCoveringDevice.with(
                    tilt ? commands.WindowCoveringTiltServer : commands.WindowCoveringLiftServer,
                ),
                state,
            };
        },
    },
    doorLock: {
        group: 'Actuators',
        label: 'Door lock',
        attributes: ['doorLock/lockState (0 not fully locked, 1 locked, 2 unlocked, 3 unlatched)'],
        build: () => {
            const {DoorLock} = cl('door-lock');
            return {
                type: dev('door-lock').DoorLockDevice.with(commands.DoorLockServer),
                state: {
                    doorLock: {
                        lockState: DoorLock.LockState.Locked,
                        lockType: DoorLock.LockType.DeadBolt,
                        actuatorEnabled: true,
                        operatingMode: DoorLock.OperatingMode.Normal,
                    },
                },
            };
        },
    },
    genericSwitch: {
        group: 'Buttons',
        label: 'Generic switch (button: single, double, long press)',
        attributes: ['switch/currentPosition (0 released, 1 pressed)'],
        build: () => {
            const {SwitchServer} = beh('switch');
            return {
                type: dev('generic-switch').GenericSwitchDevice.with(
                    SwitchServer.with(
                        'MomentarySwitch',
                        'MomentarySwitchRelease',
                        'MomentarySwitchLongPress',
                        'MomentarySwitchMultiPress',
                    ),
                ),
                state: {
                    switch: {
                        numberOfPositions: 2,
                        currentPosition: 0,
                        multiPressMax: 2,
                        longPressDelay: 800,
                        multiPressDelay: 400,
                    },
                },
            };
        },
    },
    fan: {
        group: 'Actuators',
        label: 'Fan',
        attributes: [
            'fanControl/fanMode (0 off, 1 low, 2 medium, 3 high, 4 on, 5 auto)',
            'fanControl/percentSetting (0..100)',
        ],
        build: () => {
            const {FanControl} = cl('fan-control');
            return {
                type: dev('fan').FanDevice,
                state: {
                    fanControl: {
                        fanMode: FanControl.FanMode.Off,
                        fanModeSequence: FanControl.FanModeSequence.OffHigh,
                        percentSetting: 0,
                        percentCurrent: 0,
                    },
                },
            };
        },
    },
};

const OPTION_FLAGS = ['battery', 'wired', 'humidity', 'illuminance', 'tilt'];

/** identity key of a type + options combination */
function key(name, options = {}) {
    const flags = OPTION_FLAGS.filter((f) => options[f]);
    return flags.length > 0 ? name + '+' + flags.join('+') : name;
}

/**
 * @param {string} name  type name (key of TYPES)
 * @param {object} [options]
 * @returns {{type: object, state: object, key: string}}
 */
function build(name, options = {}) {
    const def = TYPES[name];
    if (!def) {
        throw new Error('unknown Matter device type ' + name);
    }

    const {BridgedDeviceBasicInformationServer} = beh('bridged-device-basic-information');
    const base = def.build(options);
    const extras = [powerSource(options), humidity(options), illuminance(options)];
    const behaviours = [BridgedDeviceBasicInformationServer, commands.IdentifyServer];
    let state = {...base.state};
    for (const extra of extras) {
        behaviours.push(...extra.behaviours);
        state = {...state, ...extra.state};
    }

    return {type: base.type.with(...behaviours), state, key: key(name, options)};
}

/** [{name, label, group, attributes}] for editors */
function list() {
    return Object.entries(TYPES).map(([name, def]) => ({
        name,
        label: def.label,
        group: def.group,
        attributes: def.attributes,
    }));
}

function has(name) {
    return Object.prototype.hasOwnProperty.call(TYPES, name);
}

module.exports = {TYPES, OPTION_FLAGS, build, key, list, has};
