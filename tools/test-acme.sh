#!/usr/bin/env bash
# Runs tests/acme.test.ts against Pebble, Let's Encrypt's test ACME server, with
# pebble-challtestsrv answering its DNS. Needs Go. Extra arguments go to vitest.
set -euo pipefail

PEBBLE_VERSION=v2.10.1
cd "$(dirname "$0")/.."

bin="$(mktemp -d)"
cleanup() {
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$bin"
}
trap cleanup EXIT

GOBIN="$bin" go install \
  "github.com/letsencrypt/pebble/v2/cmd/pebble@$PEBBLE_VERSION" \
  "github.com/letsencrypt/pebble/v2/cmd/pebble-challtestsrv@$PEBBLE_VERSION"
pebble_dir="$(go mod download -json "github.com/letsencrypt/pebble/v2@$PEBBLE_VERSION" | sed -n 's/^\t"Dir": "\(.*\)",$/\1/p')"

"$bin/pebble-challtestsrv" -management 127.0.0.1:8055 -dnsserver 127.0.0.1:8053 \
  -http01 '' -https01 '' -tlsalpn01 '' -doh '' > "$bin/challtestsrv.log" 2>&1 &
# Pebble resolves its config's relative certificate paths from its own directory.
(cd "$pebble_dir" && PEBBLE_VA_NOSLEEP=1 PEBBLE_WFE_NONCEREJECT=0 \
  exec "$bin/pebble" -config test/config/pebble-config.json -dnsserver 127.0.0.1:8053) > "$bin/pebble.log" 2>&1 &

export PEBBLE_DIRECTORY=https://localhost:14000/dir
export CHALLTESTSRV=http://127.0.0.1:8055
export PEBBLE_MANAGEMENT=https://localhost:15000
# Pebble's own HTTPS certificate chains to this.
export NODE_EXTRA_CA_CERTS="$pebble_dir/test/certs/pebble.minica.pem"
for _ in $(seq 50); do
  curl -sf --cacert "$NODE_EXTRA_CA_CERTS" "$PEBBLE_DIRECTORY" > /dev/null && break
  sleep 0.2
done
if ! curl -sf --cacert "$NODE_EXTRA_CA_CERTS" "$PEBBLE_DIRECTORY" > /dev/null; then
  cat "$bin/pebble.log" "$bin/challtestsrv.log"
  echo "Pebble did not start" >&2
  exit 1
fi

if ! npx vitest run tests/acme.test.ts "$@"; then
  echo "--- pebble.log"; tail -40 "$bin/pebble.log"
  exit 1
fi
