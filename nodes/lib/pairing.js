/* Pairing parameters of a bridge: random suggestions for the editor, the
   validation rules of the Matter specification (5.1.7: passcodes that are
   too regular are invalid) and the sanitising of ids. No matter.js here so
   the editor endpoint can suggest values without loading the library. */

const crypto = require('crypto');

/** passcodes the specification forbids (Matter core spec 5.1.7.1) */
const INVALID_PASSCODES = new Set([
    0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999, 12345678, 87654321,
]);

function isValidPasscode(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 99999998 && !INVALID_PASSCODES.has(n);
}

function randomPasscode() {
    let n;
    do {
        n = crypto.randomInt(1, 99999999);
    } while (!isValidPasscode(n));

    return n;
}

function isValidDiscriminator(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 4095;
}

function randomDiscriminator() {
    return crypto.randomInt(0, 4096);
}

/** bridge id: 8 hex characters, unique enough per Node-RED instance */
function randomBridgeId() {
    return crypto.randomBytes(4).toString('hex');
}

function isValidBridgeId(value) {
    return /^[A-Za-z0-9._-]{1,32}$/.test(String(value));
}

function isValidPort(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1024 && n <= 65535;
}

/**
 * Endpoint ids are used as storage keys by matter.js; keep them to a safe
 * character set (CCU addresses contain ':' which matter.js escapes itself,
 * but the rest of the world does not need to see that).
 */
function endpointId(...parts) {
    return parts
        .filter((p) => p !== undefined && p !== null && p !== '')
        .map((p) => String(p).replace(/[^A-Za-z0-9:._-]/g, '_'))
        .join('~');
}

/** stable unique id (BridgedDeviceBasicInformation.uniqueId, max 32 chars) */
function uniqueId(...parts) {
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Matter limits nodeLabel to 32 characters */
function label(name, fallback = 'Device') {
    const s = String(name || fallback).trim() || fallback;
    return s.length > 32 ? s.slice(0, 32) : s;
}

module.exports = {
    INVALID_PASSCODES,
    isValidPasscode,
    randomPasscode,
    isValidDiscriminator,
    randomDiscriminator,
    randomBridgeId,
    isValidBridgeId,
    isValidPort,
    endpointId,
    uniqueId,
    label,
};
