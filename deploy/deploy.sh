#!/usr/bin/env bash
# Deploy Mentari as one container behind the host's reverse proxy.
#   deploy/deploy.sh             build HEAD from a clean `git archive`, run it, install the route, verify
#   deploy/deploy.sh --rollback  run the previous image again (held by the stopped `mentari-undo` container)
#   deploy/deploy.sh --status    container, tags, rollback image and the public health code
#   deploy/deploy.sh --check-freeze  only the freeze check below (exit 0 = a deploy may run now)
#
# From config/limits.json deploy.freezeAfter on, a new deploy is refused (decision 0040): the entry is judged as
# submitted. Only when the judges ask for a change: MENTARI_JURI_MINTA='<what they asked>'. --rollback stays open.
#
# Host values live in deploy/hos.env (not tracked; deploy/hos.env.example lists them). The demo sender key stays
# in MENTARI_SECRETS_DIR outside the repository and reaches the container as a read-only mount: never the image.
set -euo pipefail
cd "$(dirname "$0")"

# DEPLOY_LIMITS overrides the config path (tests).
freeze_check() {
  local lim=${DEPLOY_LIMITS:-../config/limits.json} at
  at=$(node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=Date.parse(l.deploy&&l.deploy.freezeAfter);if(!Number.isFinite(t))process.exit(3);console.log(Math.floor(t/1000)+" "+l.deploy.freezeAfter)' "$lim") \
    || { echo "cannot read deploy.freezeAfter from $lim: refusing to deploy"; return 1; }
  [ "$(date -u +%s)" -lt "${at%% *}" ] && return 0
  if [ -n "${MENTARI_JURI_MINTA:-}" ]; then echo "deploy freeze (${at#* }) lifted for: $MENTARI_JURI_MINTA"; return 0; fi
  echo "deploys are frozen since ${at#* } while the entry is judged; nothing was changed."
  echo "Only when the judges ask for a change: MENTARI_JURI_MINTA='<what they asked>' bash deploy/deploy.sh"
  return 1
}
case "${1:-}" in
  --check-freeze) freeze_check; exit $? ;;
  "") freeze_check || exit 1 ;;
esac
[ -r hos.env ] || { echo "deploy/hos.env missing (copy deploy/hos.env.example)"; exit 1; }
# shellcheck disable=SC1091
. ./hos.env
: "${MENTARI_DOMAIN:?}" "${MENTARI_NETWORK:?}" "${MENTARI_SECRETS_DIR:?}" "${PROXY_CONTAINER:?}" "${PROXY_DYNAMIC_DIR:?}" "${CERT_RESOLVER:?}"
BUILD_CMD=${BUILD_CMD:-docker build}
MIN_FREE_GB=${MIN_FREE_GB:-20}
export MENTARI_NETWORK MENTARI_SECRETS_DIR
DC="docker compose -f compose.yaml"
URL="https://$MENTARI_DOMAIN"
HOLDER=mentari-undo

# Certificates use the HTTP-01 challenge: a name that does not resolve fails it and burns the CA's retry budget.
dns_ok() { getent ahosts "$MENTARI_DOMAIN" >/dev/null; }

health_code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$URL/healthz" || true; }

# The page must reach visitors compressed and marked no-transform (the CDN then leaves it alone).
html_headers_ok() {
  local h
  h=$(curl -s -m 20 -o /dev/null -D - -H 'accept-encoding: br, gzip' "$URL/" | tr -d '\r' | tr 'A-Z' 'a-z') || return 1
  grep -E '^cache-control:.*no-transform' <<<"$h" >/dev/null && grep -E '^content-encoding: *(br|gzip)' <<<"$h" >/dev/null
}

hold_previous() {  # $1 = image ID the replaced container ran: keep it by ID in a stopped container
  local prev id=${1:-}
  prev=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "note: first deploy, no rollback image yet"; return 0; }
  [ -n "$id" ] || id=$(docker image inspect -f '{{.Id}}' "mentari:$prev" 2>/dev/null) || id=""
  [ -n "$id" ] || { echo "WARNING: rollback image mentari:$prev not found; --rollback will fail" >&2; return 1; }
  docker rm -f "$HOLDER" >/dev/null 2>&1 || true
  docker tag "$id" "mentari:$prev"
  docker create --name "$HOLDER" --network none --restart no --label "mentari.tag=$prev" "mentari:$prev" >/dev/null
  echo "rollback image held: mentari:$prev (${id:7:12})"
}

case "${1:-}" in
  --status)
    $DC ps
    echo "current $(cat CURRENT_TAG 2>/dev/null || echo -) · previous $(cat PREVIOUS_TAG 2>/dev/null || echo -)"
    docker inspect -f 'rollback holder: {{index .Config.Labels "mentari.tag"}}' "$HOLDER" 2>/dev/null || echo "rollback holder: none"
    echo "public /healthz $(health_code)"; exit 0 ;;
  --rollback)
    dns_ok || { echo "$MENTARI_DOMAIN does not resolve, nothing was changed"; exit 1; }
    TAG=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "no PREVIOUS_TAG"; exit 1; }
    if ! docker image inspect "mentari:$TAG" >/dev/null 2>&1; then
      id=$(docker inspect -f '{{.Image}}' "$HOLDER" 2>/dev/null) || { echo "image mentari:$TAG is gone"; exit 1; }
      docker tag "$id" "mentari:$TAG"
    fi
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  "")
    dns_ok || { echo "$MENTARI_DOMAIN does not resolve: create the DNS record first, nothing was changed"; exit 1; }
    [ -z "$(git -C .. status --porcelain)" ] || { echo "working tree not clean: commit first (the image is built from HEAD)"; exit 1; }
    free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
    [ "$free" -ge "$MIN_FREE_GB" ] || { echo "less than ${MIN_FREE_GB} GB free on /, stopping"; exit 1; }
    TAG=$(git -C .. rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M)
    ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
    git -C .. archive HEAD | tar -x -C "$ctx"   # clean tree: untracked and ignored files never reach the image
    $BUILD_CMD -t "mentari:$TAG" "$ctx"
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  *) echo "usage: deploy.sh [--rollback|--status|--check-freeze]"; exit 2 ;;
esac

old_id=$(docker inspect -f '{{.Image}}' mentari 2>/dev/null || true)

# The key folder exists before the mount (an absent source would be created by Docker, owned by root).
install -d -m 0700 "$MENTARI_SECRETS_DIR"

MENTARI_TAG=$TAG $DC up -d --force-recreate mentari
echo "$TAG" > CURRENT_TAG

route=$(mktemp)
sed -e "s|@DOMAIN@|$MENTARI_DOMAIN|g" -e "s|@CERT_RESOLVER@|$CERT_RESOLVER|g" traefik.yaml.tmpl > "$route"
docker cp "$route" "$PROXY_CONTAINER:$PROXY_DYNAMIC_DIR/mentari.yaml"; rm -f "$route"

for _ in $(seq 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' mentari)" = healthy ] && break; sleep 3; done
no_rollback=0; hold_previous "$old_id" || no_rollback=1

# Keep only the current and previous images of this project; the host disk is shared with other projects.
docker images mentari --format '{{.Tag}}' | grep -vxF -e "$TAG" -e "$(cat PREVIOUS_TAG 2>/dev/null || echo -)" \
  | sed 's/^/mentari:/' | xargs -r docker rmi >/dev/null 2>&1 || true

# A new route or certificate can take a little while: wait and retry before calling it a failure.
code=000; headers=no
for _ in $(seq 6); do
  code=$(health_code)
  if [ "$code" = 200 ] && html_headers_ok; then headers=yes; break; fi
  sleep 10
done
echo "tag $TAG · public /healthz $code · html no-transform + compressed: $headers"
[ "$code" = 200 ] || { echo "public health is not 200 yet: check the certificate and route; undo with deploy/deploy.sh --rollback"; exit 1; }
[ "$headers" = yes ] || { echo "the page is up but not compressed or not marked no-transform: check the route middleware"; exit 1; }
[ "$no_rollback" = 0 ] || { echo "live, but no rollback image is held (warning above)"; exit 1; }
