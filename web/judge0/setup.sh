#!/bin/bash

# Starts Judge0 (the sandbox that runs participants' programs) in Docker, reachable only at 127.0.0.1:2358,
# and prints the token that goes in JUDGE0_AUTH_TOKEN in ../ecosystem.config.cjs.
# judge0.conf is written from judge0.conf.template: new random secrets the first time, the existing ones after
# that. Rerun it after changing the template or docker-compose.yml; it restarts Judge0 only if something changed.
# Needs Docker with Compose v2 ("docker compose"). On a server, run it with sudo unless you're in the docker group.
# Usage:
#	./setup.sh

set -euo pipefail
cd "$(dirname "$0")"

docker compose version >/dev/null 2>&1 || { echo "Needs Docker with Compose v2 (\"docker compose\")."; exit 1; }

secret() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
keep() { [ -f judge0.conf ] && sed -n "s/^$1=//p" judge0.conf | head -1; }
REDIS_PASSWORD="$(keep REDIS_PASSWORD || true)"; REDIS_PASSWORD="${REDIS_PASSWORD:-$(secret)}"
POSTGRES_PASSWORD="$(keep POSTGRES_PASSWORD || true)"; POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(secret)}"
TOKEN="$(keep AUTHN_TOKEN || true)"; TOKEN="${TOKEN:-$(secret)}"

NEW="$(sed -e "s/@REDIS_PASSWORD@/$REDIS_PASSWORD/" -e "s/@POSTGRES_PASSWORD@/$POSTGRES_PASSWORD/" -e "s/@AUTHN_TOKEN@/$TOKEN/" judge0.conf.template)"
CHANGED=false
if [ ! -f judge0.conf ] || [ "$NEW" != "$(cat judge0.conf)" ]; then
    [ -f judge0.conf ] && CHANGED=true
    (umask 077; printf '%s\n' "$NEW" > judge0.conf)
    chmod 600 judge0.conf
    echo "Wrote judge0.conf."
fi

# The database has to be up before Judge0 connects to it.
docker compose up -d db redis
sleep 10
if [ "$CHANGED" = true ]; then
    docker compose up -d --force-recreate server workers   # they read judge0.conf only when they start
fi
docker compose up -d

echo "Waiting for Judge0 to answer..."
for _ in $(seq 1 60); do
    if curl -sf -H "X-Auth-Token: $TOKEN" http://127.0.0.1:2358/about >/dev/null 2>&1; then
        echo "Judge0 is running at http://127.0.0.1:2358"
        echo "Put this in ecosystem.config.cjs:  JUDGE0_AUTH_TOKEN: \"$TOKEN\""
        echo "Then check it from the app's folder:  npm run check:runner"
        exit 0
    fi
    sleep 2
done
echo "Judge0 didn't answer within 2 minutes. See: docker compose logs --tail 50 server workers"
exit 1
