#!/bin/bash
# Local smoke test (ROADMAP task 6/15): packs this checkout, installs it the
# way RedMatic 9's palette manager does (shallow, no lockfile) into a fresh
# Node-RED user directory, deploys a bridge with universal/switch/pseudobutton
# nodes, reads the pairing code from the admin endpoint and browses mDNS for
# the commissionable service. Needs network access for the npm installs.
#
#   tools/smoke-local.sh            # Node-RED 5 (default)
#   NODE_RED=4 tools/smoke-local.sh # Node-RED 4
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$(mktemp -d -t redmatic-matter-smoke.XXXXXX)}
PORT=${PORT:-1891}
MATTER_PORT=${MATTER_PORT:-5591}
NODE_RED=${NODE_RED:-5}

echo "work dir: $WORK"
TGZ=$(cd "$ROOT" && npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)
mkdir -p "$WORK/userDir" && cd "$WORK/userDir"
npm init -y >/dev/null
START=$(date +%s)
npm install --install-strategy=shallow --no-package-lock --no-audit --no-fund "node-red@$NODE_RED" "$WORK/$TGZ" 2>&1 | tail -1
echo "install took $(( $(date +%s) - START ))s; nested deps of redmatic-matter: $(ls node_modules/redmatic-matter/node_modules 2>/dev/null | wc -l | tr -d ' ')"
echo "size of @matter: $(du -sh node_modules/@matter 2>/dev/null | cut -f1) ($(find node_modules/@matter -type f | wc -l | tr -d ' ') files)"

cat > "$WORK/flows.json" <<EOF
[
 {"id":"bridge1","type":"redmatic-matter-bridge","name":"Smoke Bridge","bridgeId":"smoke0001","port":$MATTER_PORT,"passcode":20202021,"discriminator":3840,"ipv4":true},
 {"id":"tab1","type":"tab","label":"matter smoke"},
 {"id":"uni1","type":"redmatic-matter-universal","z":"tab1","name":"Smoke Lamp","bridgeConfig":"bridge1","endpoints":[{"type":"dimmableLight","name":"Smoke Lamp"},{"type":"temperatureSensor","name":"Smoke Temp","humidity":true}],"x":300,"y":100,"wires":[["sw1"]]},
 {"id":"btn1","type":"redmatic-matter-pseudobutton","z":"tab1","name":"Smoke Button","bridgeConfig":"bridge1","topic":"smoke","payload":"","payloadType":"date","x":300,"y":160,"wires":[[]]},
 {"id":"sw1","type":"redmatic-matter-switch","z":"tab1","name":"Smoke Switch","bridgeConfig":"bridge1","as":"plug","x":600,"y":100,"wires":[[]]}
]
EOF

node node_modules/node-red/red.js --userDir "$WORK/userDir" --port "$PORT" > "$WORK/node-red.log" 2>&1 &
NR=$!
trap 'kill $NR 2>/dev/null; wait $NR 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "localhost:$PORT/flows" && break; sleep 1; done
echo "node-red $NODE_RED up after ${i}s"
curl -s -X POST -H "Content-Type: application/json" -H "Node-RED-Deployment-Type: full" --data @"$WORK/flows.json" "localhost:$PORT/flows" >/dev/null
for i in $(seq 1 60); do grep -q "bridge online" "$WORK/node-red.log" && break; sleep 1; done
grep "bridge online" "$WORK/node-red.log" || { echo "bridge did not come online"; tail -30 "$WORK/node-red.log"; exit 1; }

echo "--- bridge info"; curl -s "localhost:$PORT/redmatic-matter/bridge?config=bridge1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("state",j.state,"commissioned",j.commissioned,"endpoints",j.endpoints.map(e=>e.number+":"+e.type).join(" "));console.log("pairing code",j.pairingCodes&&j.pairingCodes.manualPairingCode,j.pairingCodes&&j.pairingCodes.qrPairingCode)})'
echo "--- storage"; ls "$WORK/userDir/matter"
if command -v dns-sd >/dev/null; then
    echo "--- dns-sd (5s)"
    dns-sd -B _matterc._udp local. > "$WORK/dnssd.log" 2>&1 & DS=$!
    sleep 5; kill $DS 2>/dev/null
    grep -q "_matterc._udp" "$WORK/dnssd.log" && cat "$WORK/dnssd.log" | tail -3 || echo "bridge NOT seen via mDNS"
elif command -v avahi-browse >/dev/null; then
    echo "--- avahi-browse (5s)"
    timeout 5 avahi-browse -rt _matterc._udp 2>/dev/null | grep -A3 "Smoke\|hostname" | head -8 || echo "bridge NOT seen via mDNS"
fi
echo "--- errors/warnings in the log"; grep -i "error\|warn" "$WORK/node-red.log" | grep -v "Encrypted credentials\|Projects disabled\|development values\|productLabel should not" || echo "(none)"
echo "done — work dir kept at $WORK"
