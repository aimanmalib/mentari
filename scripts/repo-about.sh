#!/usr/bin/env bash
# The GitHub About box (description, homepage, topics) lives in config/repo.json, not in the GitHub settings page.
#   bash scripts/repo-about.sh          compare GitHub with the config; exit 1 and print the difference on drift
#   bash scripts/repo-about.sh --apply  write the config to GitHub, then compare again
# Needs the gh CLI, signed in with write access for --apply. Override the config path with REPO_ABOUT_CONFIG (tests).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONFIG=${REPO_ABOUT_CONFIG:-$ROOT/config/repo.json}

field() { node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = c[process.argv[2]];
  console.log(Array.isArray(v) ? [...v].sort().join("\n") : v)' "$CONFIG" "$1"; }
REPO=$(field repo)

if [ "${1:-}" = "--apply" ]; then
  gh api -X PATCH "repos/$REPO" -f description="$(field description)" -f homepage="$(field homepage)" >/dev/null
  args=()
  while IFS= read -r t; do args+=(-f "names[]=$t"); done < <(field topics)
  gh api -X PUT "repos/$REPO/topics" "${args[@]}" >/dev/null
fi

want=$(printf '%s\n%s\n%s\n' "$(field description)" "$(field homepage)" "$(field topics)")
have=$(gh api "repos/$REPO" --jq '.description, .homepage, (.topics | sort | .[])')
if [ "$want" = "$have" ]; then
  echo "repo-about: GitHub matches config/repo.json"
else
  echo "repo-about: GitHub differs from config/repo.json (- config, + GitHub)"
  diff <(echo "$want") <(echo "$have") || true
  exit 1
fi
