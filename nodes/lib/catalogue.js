/* What the editor's device list shows (ROADMAP task 10 step 1): for every
   device of the enabled interfaces of a ccu-connection node the channels,
   their detected role, the Matter device type they become, the choices per
   channel and the options per device. Devices the mapping does not know are
   listed as unsupported with their channel types, so a bug report contains
   what is needed. The editor renders whatever this returns. */

const mapping = require('./mapping');

/**
 * @param {object} ccu  ccu-connection node (metadata.devices, channelNames, enabledIfaces, getParamsetDescription)
 * @param {object} [options]  the node's per-address config (for the current type choices)
 * @param {object} [channelModes]  CHANNEL_OPERATION_MODE per address
 */
function describeDevices(ccu, options = {}, channelModes = {}) {
    const devices = [];
    for (const [iface, ifaceDevices] of Object.entries((ccu.metadata && ccu.metadata.devices) || {})) {
        if (!ccu.enabledIfaces.includes(iface)) {
            continue;
        }

        for (const device of Object.values(ifaceDevices)) {
            if (device.PARENT || !device.TYPE) {
                continue;
            }

            let p;
            try {
                p = mapping.plan(device, ccu, iface, options, channelModes);
            } catch (error) {
                devices.push({
                    iface,
                    address: device.ADDRESS,
                    type: device.TYPE,
                    name: (ccu.channelNames && ccu.channelNames[device.ADDRESS]) || device.ADDRESS,
                    supported: false,
                    error: error.message,
                    options: [],
                    channels: [],
                    unsupported: [],
                });
                continue;
            }

            devices.push(describePlan(p, device));
        }
    }

    return devices.sort((a, b) => a.name.localeCompare(b.name));
}

function describePlan(p, device) {
    const channelTypes = (device.CHILDREN || []).length;
    return {
        iface: p.iface,
        address: p.address,
        type: p.type,
        name: p.name,
        supported: p.supported,
        optIn: p.optIn,
        options: p.options,
        channelCount: channelTypes,
        channels: p.endpoints.map((e) => ({
            address: e.address,
            name: e.name,
            role: e.role,
            channelType: e.channelType,
            matterType: e.type,
            dropdowns: e.dropdowns,
            optIn: e.optIn,
            battery: Boolean(e.battery),
        })),
        unsupported: p.unsupported,
    };
}

module.exports = {describeDevices, describePlan};
