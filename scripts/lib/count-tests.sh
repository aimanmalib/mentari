# Sourced by scripts/gerbang-ujian.sh. Each function reads test runner output on stdin and prints "<passed> <skipped>".

# vitest prints "Tests  N passed (N)" or "Tests  N passed | M skipped (T)". Under `pnpm -r` with more than one package,
# every line is prefixed with "<package> test: ", so the summary is matched anywhere in the line. Colour codes (vitest
# colours its output when CI is set, as on GitHub Actions) are removed first.
count_vitest() {
  sed -E $'s/\x1b\\[[0-9;]*m//g' |
    grep -oE '(^|[^[:alnum:]])Tests +[0-9]+ passed[^(]*' |
    awk '{for (i = 1; i <= NF; i++) {if ($i == "Tests") p += $(i + 1); if ($i == "skipped" ) s += $(i - 1)}}
      END {print p + 0, s + 0}'
}

# forge prints "N tests passed, F failed, S skipped" per suite and once more as the total; the last line wins.
count_forge() {
  grep -oE '[0-9]+ tests passed, [0-9]+ failed, [0-9]+ skipped' | tail -1 | awk '{print $1, $6}'
}

# Playwright's list reporter ends with "  N passed (12.3s)", and "  M skipped" or "  F flaky" lines when there are any.
# A flaky test (passed only on retry) is counted with the skipped ones, so the gate refuses it too.
count_playwright() {
  sed -E $'s/\x1b\\[[0-9;]*m//g' |
    grep -E '^ +[0-9]+ (passed|skipped|flaky)( |$)' |
    awk '$2 == "passed" {p += $1} $2 == "skipped" || $2 == "flaky" {s += $1} END {print p + 0, s + 0}'
}
