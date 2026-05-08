#!/usr/bin/env bash
# ─── ECCA // Unit & Contract Test Runner ────────────────────────────────────
# Runs all package-level unit tests and Solidity contract tests in sequence,
# captures structured output, and generates an HTML report matching the
# e2e-report.html format.
#
# Usage:
#   ./run-unit-tests.sh               # run all tests, generate report
#   ./run-unit-tests.sh --packages    # packages only (skip contracts)
#   ./run-unit-tests.sh --contracts   # contracts only (skip packages)
#
# Outputs:
#   unit-test-report.html   — visual report (same style as e2e-report.html)
#   .test-results.json      — machine-readable results
#
# This script runs ALONGSIDE e2e.sh / run-tests.sh. It covers the lower
# layers that don't require Docker services to be running.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

# ── Flags ───────────────────────────────────────────────────────────────────
RUN_PACKAGES=true
RUN_CONTRACTS=true
for arg in "$@"; do
  case "$arg" in
    --packages)  RUN_CONTRACTS=false ;;
    --contracts) RUN_PACKAGES=false ;;
  esac
done

# ── Colors ──────────────────────────────────────────────────────────────────
G='\033[0;32m'; R='\033[0;31m'; C='\033[0;36m'; Y='\033[0;33m'; N='\033[0m'

# ── Result accumulator ─────────────────────────────────────────────────────
RESULTS_JSON=".test-results.json"
echo '{"suites":[],"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > "$RESULTS_JSON"

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_TESTS=0
SUITE_IDX=0

# ── Run a single package test suite ─────────────────────────────────────────
run_package_test() {
  local name="$1"
  local filter="$2"
  local desc="$3"
  SUITE_IDX=$((SUITE_IDX + 1))

  echo -e "\n${C}[$SUITE_IDX] Testing $name${N}"
  echo -e "    ${Y}$desc${N}"

  local output
  local exit_code=0

  # Build first (turbo will cache if already built)
  pnpm --filter "$filter" build > /dev/null 2>&1 || true

  output=$(pnpm --filter "$filter" test 2>&1) || exit_code=$?

  # Parse Node.js test runner output
  local pass=$(echo "$output" | grep "^ℹ pass" | awk '{print $NF}' | head -1)
  local fail=$(echo "$output" | grep "^ℹ fail" | awk '{print $NF}' | head -1)
  local total=$(echo "$output" | grep "^ℹ tests" | awk '{print $NF}' | head -1)
  local duration=$(echo "$output" | grep "^ℹ duration_ms" | awk '{print $NF}' | head -1)

  pass=${pass:-0}; fail=${fail:-0}; total=${total:-0}; duration=${duration:-0}

  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_TESTS=$((TOTAL_TESTS + total))

  if [ "$fail" -eq 0 ] && [ "$exit_code" -eq 0 ]; then
    echo -e "    ${G}✓ $pass/$total passed${N} (${duration}ms)"
  else
    echo -e "    ${R}✗ $pass/$total passed, $fail failed${N} (${duration}ms)"
  fi

  # Extract individual test results
  local tests_json="[]"
  tests_json=$(echo "$output" | grep -E "^  [✔✖]" | while IFS= read -r line; do
    local status="pass"
    echo "$line" | grep -q "✖" && status="fail"
    local tname=$(echo "$line" | sed 's/^  [✔✖] //' | sed 's/ (.*//' | sed 's/"/\\"/g')
    local tdur=$(echo "$line" | grep -oE '\([0-9.]+ms\)' | tr -d '()ms' || echo "0")
    echo "{\"name\":\"$tname\",\"status\":\"$status\",\"duration\":$tdur}"
  done | paste -sd',' - || echo "")

  if [ -z "$tests_json" ]; then
    tests_json="[]"
  else
    tests_json="[$tests_json]"
  fi

  # Append to results JSON
  local suite_json="{\"name\":\"$name\",\"filter\":\"$filter\",\"desc\":\"$desc\",\"pass\":$pass,\"fail\":$fail,\"total\":$total,\"duration\":$duration,\"tests\":$tests_json}"

  # Use node to merge JSON (portable)
  node -e "
    const fs = require('fs');
    const r = JSON.parse(fs.readFileSync('$RESULTS_JSON','utf8'));
    r.suites.push($suite_json);
    fs.writeFileSync('$RESULTS_JSON', JSON.stringify(r, null, 2));
  "
}

# ── Run Hardhat contract tests ──────────────────────────────────────────────
run_contract_tests() {
  SUITE_IDX=$((SUITE_IDX + 1))
  local name="contracts"
  local desc="Solidity smart contracts — StackIdentity, BandwidthToken, EpochAnchor, TripartiteGame, ResidueRegistry, NeedlecastRouter, QuellistTreasury, SleeveRegistry"

  echo -e "\n${C}[$SUITE_IDX] Testing Solidity Contracts${N}"
  echo -e "    ${Y}$desc${N}"

  local output
  local exit_code=0
  output=$(cd contracts && npx hardhat test 2>&1) || exit_code=$?

  # Parse Hardhat/Mocha output
  local summary=$(echo "$output" | grep -E "^\s+\d+ passing")
  local pass=$(echo "$summary" | grep -oE '[0-9]+' | head -1)
  local fail_line=$(echo "$output" | grep -E "^\s+\d+ failing" || echo "")
  local fail=$(echo "$fail_line" | grep -oE '[0-9]+' | head -1)
  local duration=$(echo "$summary" | grep -oE '\([^)]+\)' | tr -d '()' || echo "0ms")

  pass=${pass:-0}; fail=${fail:-0}

  local total=$((pass + fail))
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_TESTS=$((TOTAL_TESTS + total))

  if [ "$fail" -eq 0 ] && [ "$exit_code" -eq 0 ]; then
    echo -e "    ${G}✓ $pass/$total passed${N} ($duration)"
  else
    echo -e "    ${R}✗ $pass/$total passed, $fail failed${N} ($duration)"
  fi

  # Extract individual test names from Hardhat output
  local tests_json="[]"
  tests_json=$(echo "$output" | grep -E "^\s+[✔✓]" | while IFS= read -r line; do
    local tname=$(echo "$line" | sed 's/^[[:space:]]*[✔✓][[:space:]]*//' | sed 's/"/\\"/g')
    echo "{\"name\":\"$tname\",\"status\":\"pass\",\"duration\":0}"
  done | paste -sd',' - || echo "")

  local fail_tests=$(echo "$output" | grep -E "^\s+\d+\)" | while IFS= read -r line; do
    local tname=$(echo "$line" | sed 's/^[[:space:]]*[0-9]*)[[:space:]]*//' | sed 's/"/\\"/g')
    echo "{\"name\":\"$tname\",\"status\":\"fail\",\"duration\":0}"
  done | paste -sd',' - || echo "")

  if [ -n "$fail_tests" ]; then
    if [ -n "$tests_json" ]; then
      tests_json="$tests_json,$fail_tests"
    else
      tests_json="$fail_tests"
    fi
  fi

  if [ -z "$tests_json" ]; then
    tests_json="[]"
  else
    tests_json="[$tests_json]"
  fi

  local suite_json="{\"name\":\"$name\",\"filter\":\"@ecca/contracts\",\"desc\":\"$desc\",\"pass\":$pass,\"fail\":$fail,\"total\":$total,\"duration\":0,\"tests\":$tests_json}"

  node -e "
    const fs = require('fs');
    const r = JSON.parse(fs.readFileSync('$RESULTS_JSON','utf8'));
    r.suites.push($suite_json);
    fs.writeFileSync('$RESULTS_JSON', JSON.stringify(r, null, 2));
  "
}

# ── Main ────────────────────────────────────────────────────────────────────
echo -e "${C}╔══════════════════════════════════════════════════════════════╗${N}"
echo -e "${C}║          ECCA // Unit & Contract Test Runner                ║${N}"
echo -e "${C}╚══════════════════════════════════════════════════════════════╝${N}"
echo ""
echo -e "Timestamp: ${Y}$(date -u +%Y-%m-%dT%H:%M:%SZ)${N}"
echo ""

if $RUN_PACKAGES; then
  run_package_test "@ecca/proto" "@ecca/proto" \
    "Token taxonomy, event schemas, zod validators, constants. The shared type contract between all 24 services."

  run_package_test "@ecca/crypto" "@ecca/crypto" \
    "SHA-256, HKDF-SHA512 key derivation, AES-256-GCM encryption, Ed25519 signatures, Merkle trees, MMR, coherence roots. All via @noble audited libraries."

  run_package_test "@ecca/chain" "@ecca/chain" \
    "Cortex EVM (viem), Hippocampus DAG (HTTP), Medulla PoW (JSON-RPC) client wrappers. ABI validation for all 7 contracts. TripartiteGame resource enum."

  run_package_test "@ecca/service-base" "@ecca/service-base" \
    "Fastify bootstrap, health/readiness probes, CORS, graceful shutdown. Every TypeScript service uses this foundation."

  run_package_test "@ecca/semantic-address" "@ecca/semantic-address" \
    "Hierarchical content-derived addressing: 5-facet grammar (domain>entity>relation>temporal>qualifier), prefix queries, address book, NLP parser."
fi

if $RUN_CONTRACTS; then
  run_contract_tests
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}═══════════════════════════════════════════════════════════════${N}"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo -e "${G}  ✓ ALL TESTS PASSED: $TOTAL_PASS/$TOTAL_TESTS${N}"
else
  echo -e "${R}  ✗ $TOTAL_FAIL FAILURES out of $TOTAL_TESTS tests ($TOTAL_PASS passed)${N}"
fi
echo -e "${C}═══════════════════════════════════════════════════════════════${N}"

# ── Finalize JSON ───────────────────────────────────────────────────────────
node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync('$RESULTS_JSON','utf8'));
  r.totalPass = $TOTAL_PASS;
  r.totalFail = $TOTAL_FAIL;
  r.totalTests = $TOTAL_TESTS;
  fs.writeFileSync('$RESULTS_JSON', JSON.stringify(r, null, 2));
"

# ── Generate HTML report ───────────────────────────────────────────────────
echo ""
echo -e "Generating HTML report..."
node scripts/generate-test-report.js
echo -e "${G}  → unit-test-report.html${N}"
echo -e "${G}  → docs/unit-test-report.html${N}"

if [ "$TOTAL_FAIL" -gt 0 ]; then
  exit 1
fi
