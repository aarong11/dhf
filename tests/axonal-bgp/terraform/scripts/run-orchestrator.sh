#!/usr/bin/env bash
# Apply the orchestrator job, wait for completion, collect results, generate report.
set -euo pipefail

: "${BGP_DIR:?BGP_DIR required}"
: "${REPO_ROOT:?REPO_ROOT required}"
: "${K8S_DIR:?K8S_DIR required}"
: "${RESULTS_DIR:?RESULTS_DIR required}"
: "${EPOCHS:?EPOCHS required}"

mkdir -p "$RESULTS_DIR"

# Idempotent re-run: delete prior job
kubectl -n bgp-sim delete job bgp-orchestrator --ignore-not-found

# Capture environment metadata
GIT_COMMIT="${GIT_COMMIT:-${GITHUB_SHA:-$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo local)}}"
GIT_BRANCH="${GIT_BRANCH:-${GITHUB_REF_NAME:-$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}}"
BGP_CLUSTER="${BGP_CLUSTER:-${CLUSTER_NAME:-axonal-bgp}}"
BGP_RUNNER="${BGP_RUNNER:-${GITHUB_ACTIONS:+github-actions}}"
BGP_RUNNER="${BGP_RUNNER:-local}"
BGP_LATENCY="${BGP_LATENCY:-none (same-cluster)}"

# Inject env into manifest
sed \
  -e "s|EPOCHS_PLACEHOLDER|${EPOCHS}|g" \
  -e "s|BGP_CLUSTER_PLACEHOLDER|${BGP_CLUSTER}|g" \
  -e "s|BGP_LATENCY_PLACEHOLDER|${BGP_LATENCY}|g" \
  -e "s|GIT_COMMIT_PLACEHOLDER|${GIT_COMMIT}|g" \
  -e "s|BGP_RUNNER_PLACEHOLDER|${BGP_RUNNER}|g" \
  -e "s|GIT_BRANCH_PLACEHOLDER|${GIT_BRANCH}|g" \
  "${K8S_DIR}/03-orchestrator.yaml" \
  | kubectl apply -f -

# Wait — 10s per epoch + 120s startup buffer
TIMEOUT=$((EPOCHS * 10 + 120))
echo "Waiting up to ${TIMEOUT}s for orchestrator to complete (${EPOCHS} epochs)..."

if ! kubectl -n bgp-sim wait --for=condition=complete \
       job/bgp-orchestrator --timeout=${TIMEOUT}s; then
  echo "WARN: orchestrator did not complete; collecting partial results"
  kubectl -n bgp-sim logs job/bgp-orchestrator --tail=50 || true
fi

# Collect results
kubectl -n bgp-sim logs job/bgp-orchestrator > "${RESULTS_DIR}/orchestrator.log" 2>/dev/null || true

ORCH_POD=$(kubectl -n bgp-sim get pods -l job-name=bgp-orchestrator -o name | head -1)
if [ -n "$ORCH_POD" ]; then
  if ! kubectl -n bgp-sim cp "${ORCH_POD#pod/}:/results/axonal-bgp-results.json" \
         "${RESULTS_DIR}/axonal-bgp-results.json" 2>/dev/null; then
    # Fallback: extract JSON from log
    awk '
      /^═══ RESULTS JSON ═══/ { flag=1; next }
      flag && /^═══════════════════════════════════════════════════════════/ { exit }
      flag { print }
    ' "${RESULTS_DIR}/orchestrator.log" \
      > "${RESULTS_DIR}/axonal-bgp-results.json" || true
  fi
fi

# Validate JSON
if [ -s "${RESULTS_DIR}/axonal-bgp-results.json" ]; then
  if ! python3 -c "import json,sys; json.load(open('${RESULTS_DIR}/axonal-bgp-results.json'))" 2>/dev/null; then
    echo "WARN: extracted JSON is not valid"
    echo '{}' > "${RESULTS_DIR}/axonal-bgp-results.json"
  fi
fi

echo "✓ Results collected in $RESULTS_DIR"

# Generate HTML report
if [ -s "${RESULTS_DIR}/axonal-bgp-results.json" ]; then
  cd "$REPO_ROOT"
  node "${BGP_DIR}/generate-report.js" \
    "${RESULTS_DIR}/axonal-bgp-results.json" \
    "${BGP_DIR}/axonal-bgp-report.html" \
    "${REPO_ROOT}/docs/axonal-bgp-report.html" || \
    echo "WARN: report generation failed"
  echo "✓ Report at ${BGP_DIR}/axonal-bgp-report.html"
else
  echo "WARN: no results JSON to render"
fi
