/* Controller vendor ids as they appear in a fabric's rootVendorId, for the
   fabric list of the bridge dialog (CSA vendor id registry). */

const VENDORS = {
    0x1349: 'Apple Home',
    0x1384: 'Apple Home (Keychain)', // the second fabric iOS adds next to 0x1349 (seen 2026-09-04)
    0x6006: 'Google Home',
    0x134f: 'Amazon Alexa',
    0x10e1: 'Samsung SmartThings',
    0x1385: 'Home Assistant',
    0x1217: 'Tuya',
    0x1440: 'Aqara',
    0x100b: 'Philips Hue',
    0x131b: 'ioBroker (matter.js)',
    0xfff1: 'Test vendor',
    0xfff2: 'Test vendor',
    0xfff3: 'Test vendor',
    0xfff4: 'Test vendor',
};

function vendorName(vendorId) {
    const id = Number(vendorId);
    return VENDORS[id] || '0x' + id.toString(16).padStart(4, '0');
}

module.exports = {VENDORS, vendorName};
