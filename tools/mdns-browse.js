#!/usr/bin/env node
/* Minimal mDNS browser for the Matter commissionable service, without
   dependencies: sends a PTR query for _matterc._udp.local on IPv4 and IPv6
   multicast and prints every answer that names the service, with the
   sender address. Usage: node tools/mdns-browse.js [seconds] [service] */

const dgram = require('dgram');

const seconds = Number(process.argv[2] || 5);
const service = process.argv[3] || '_matterc._udp.local';

function query(name) {
    const parts = name.split('.').filter(Boolean);
    const qname = Buffer.concat([
        ...parts.map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)])),
        Buffer.from([0]),
    ]);
    const header = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    return Buffer.concat([header, qname, Buffer.from([0, 12, 0, 1])]); // PTR, IN
}

/** crude: extract readable labels from a DNS packet */
function labels(buffer) {
    const text = buffer.toString('latin1').replace(/[^\x20-\x7e]+/g, ' ');
    return text.replace(/\s+/g, ' ').trim();
}

const seen = new Set();
function listen(type, address, group, iface) {
    const socket = dgram.createSocket({type, reuseAddr: true});
    socket.on('error', (error) => console.error(type, 'error', error.message));
    socket.on('message', (message, rinfo) => {
        const text = labels(message);
        if (text.includes(service.split('.')[0]) || text.includes('_matter')) {
            const key = rinfo.address + ' ' + text.slice(0, 200);
            if (!seen.has(key)) {
                seen.add(key);
                console.log(type, 'from', rinfo.address + ':', text.slice(0, 300));
            }
        }
    });
    socket.bind(5353, () => {
        try {
            socket.addMembership(group, iface);
        } catch (error) {
            console.error(type, 'membership', error.message);
        }

        socket.send(query(service), 5353, address);
    });
    return socket;
}

const sockets = [listen('udp4', '224.0.0.251', '224.0.0.251'), listen('udp6', 'ff02::fb', 'ff02::fb')];
setTimeout(() => {
    for (const s of sockets) {
        s.close();
    }

    console.log(seen.size ? seen.size + ' answer(s)' : 'no answers');
}, seconds * 1000);
