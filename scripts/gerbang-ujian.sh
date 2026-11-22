#!/usr/bin/env bash
# Test gate: contracts (build, tests, format, coverage), TypeScript tests, secret scan.
# Runs the same on a developer machine and in CI. Missing tools are installed at pinned versions,
# and each download is checked against its published sha256.
set -euo pipefail

# Git hooks export GIT_DIR and friends; tests that run git in temp folders must not inherit them.
while IFS= read -r v; do unset "$v"; done < <(env | grep -o '^GIT_[A-Z_]*' || true)

cd "$(dirname "$0")/.."
root=$PWD

FOUNDRY_VERSION=v1.8.7
FOUNDRY_SHA256=ba470eb718e779e4b0e3f1520b5284231b1bf98e9a39de07fb8f77ed70525bcf
GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
# Line coverage required for contracts/src once there are product contracts (the test goal is 90 %).
MIN_COVERAGE=90

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tools="$root/.tools"
step() { printf '\n== %s\n' "$1"; }
fail() { echo "gate: $*" >&2; exit 1; }
started=$(date +%s)

# fetch <url> <sha256> <dest>: download and verify, or stop.
fetch() {
  curl -fsSL --retry 3 -o "$3" "$1"
  echo "$2  $3" | sha256sum -c --quiet - || fail "checksum mismatch for $1"
}

# Prefer Node 22 from nvm when the default node is older.
need=$(tr -dc '0-9' < .nvmrc)
major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(major)" != "$need" ] && [ -d "${NVM_DIR:-$HOME/.nvm}/versions/node" ]; then
  candidate=$(ls -d "${NVM_DIR:-$HOME/.nvm}/versions/node/v${need}."* 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$candidate" ] && export PATH="$candidate/bin:$PATH"
fi
[ "$(major)" = "$need" ] || fail "Node $need required, found $(node -v 2>/dev/null || echo none)"

# Foundry: use the pinned version if it is already installed, otherwise install it into .tools/.
export PATH="$tools/bin:$HOME/.foundry/bin:$PATH"
if ! forge --version 2>/dev/null | grep -q "Version: ${FOUNDRY_VERSION#v}"; then
  step "install foundry $FOUNDRY_VERSION"
  mkdir -p "$tools/bin"
  fetch "https://github.com/foundry-rs/foundry/releases/download/$FOUNDRY_VERSION/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz" \
    "$FOUNDRY_SHA256" "$tmp/foundry.tar.gz"
  tar -xzf "$tmp/foundry.tar.gz" -C "$tools/bin" forge cast anvil
  export PATH="$tools/bin:$PATH"
fi
if ! command -v gitleaks >/dev/null; then
  step "install gitleaks $GITLEAKS_VERSION"
  mkdir -p "$tools/bin"
  fetch "https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    "$GITLEAKS_SHA256" "$tmp/gitleaks.tar.gz"
  tar -xzf "$tmp/gitleaks.tar.gz" -C "$tools/bin" gitleaks
fi

# forge-std is a git submodule; CI checkouts do not fetch submodules by default.
if [ ! -f contracts/lib/forge-std/src/Test.sol ]; then
  step "fetch submodules"
  git submodule update --init --depth 1 contracts/lib/forge-std
fi

# shellcheck source=scripts/lib/count-tests.sh
source "$root/scripts/lib/count-tests.sh"

# strict <runner> <label> <command…>: run a test command and fail unless tests really ran and none was skipped.
strict() {
  local runner=$1 label=$2 out rc=0 counts
  shift 2
  out=$("$@" 2>&1) || rc=$?
  printf '%s\n' "$out" | tail -n 12
  [ "$rc" -eq 0 ] || fail "$label failed (exit $rc)"
  case $runner in
    forge) counts=$(count_forge <<<"$out" || true) ;;
    vitest) counts=$(count_vitest <<<"$out" || true) ;;
    playwright) counts=$(count_playwright <<<"$out" || true) ;;
  esac
  read -r passed skipped <<<"${counts:-0 0}"
  [ "${passed:-0}" -ge 1 ] || fail "$label: no tests ran"
  [ "${skipped:-0}" -eq 0 ] || fail "$label: $skipped tests skipped"
  echo "gate: $label ran $passed tests"
}

cd contracts
step "forge build"; forge build --deny-warnings >"$tmp/build.log" 2>&1 || { tail -n 30 "$tmp/build.log"; fail "forge build failed"; }
step "forge fmt";   forge fmt --check || fail "run 'forge fmt' in contracts/"
step "forge test";  strict forge "forge test" forge test
if compgen -G 'src/*.sol' >/dev/null; then
  step "forge coverage"
  forge coverage --report lcov --report-file "$tmp/lcov.info" --no-match-coverage 'test/' >/dev/null 2>&1 ||
    fail "forge coverage failed"
  pct=$(awk -F: '/^SF:/ {s = ($2 ~ /^src\//)} s && /^LF:/ {f += $2} s && /^LH:/ {h += $2} END {printf "%d", f ? h * 100 / f : 0}' \
    "$tmp/lcov.info")
  echo "line coverage of contracts/src: $pct %"
  [ "$pct" -ge "$MIN_COVERAGE" ] || fail "line coverage $pct % is below $MIN_COVERAGE %"
fi
cd "$root"

if [ -d node_modules ]; then
  step "typecheck"; pnpm -r --if-present typecheck
  step "unit tests"; strict vitest "vitest" pnpm -r --if-present test
  step "web build"; pnpm --filter @mentari/web build >"$tmp/web-build.log" 2>&1 || { tail -n 30 "$tmp/web-build.log"; fail "web build failed"; }
  # The image runs the server bundle with no node_modules; a package that cannot be bundled fails here, not on deploy.
  step "server build"; pnpm --filter @mentari/server build >"$tmp/server-build.log" 2>&1 || { tail -n 30 "$tmp/server-build.log"; fail "server build failed"; }
  # Browser tests of the wallet path (Chromium and WebKit as on an iPhone 13). CI installs the browsers first.
  step "browser tests"; strict playwright "playwright" pnpm exec playwright test
fi

step "secret scan"
gitleaks git --redact --no-banner --log-level warn . || fail "gitleaks found a secret in the history"
# Working tree: only files git would publish (tracked or untracked but not ignored), without the vendored
# submodule. Copying them out keeps node_modules, build output and git-ignored notes out of the scan
# without an allowlist in the repo.
mkdir -p "$tmp/scan"
git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' f; do [ -f "$f" ] && [ ! -L "$f" ] && printf '%s\0' "$f"; done \
  | xargs -0 -r cp --parents -t "$tmp/scan"
gitleaks dir --redact --no-banner --log-level warn "$tmp/scan" || fail "gitleaks found a secret in the working tree"

echo
echo "gate: OK in $(( $(date +%s) - started ))s"
